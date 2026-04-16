import * as path from 'path';
import * as fs from 'fs';

/** Maximum local dep files auto-included per request (keeps budget predictable). */
const MAX_DEP_FILES = 25;

/** Maximum recursion depth for nested imports - deeper for Go's nested service structure. */
const MAX_IMPORT_DEPTH = 6;

/** File extensions tried when resolving a bare import specifier. */
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.go', '.rs'];

/** Patterns for Go import declarations */
const GO_IMPORT_REGEX = /import\s+(?:\([^)]*\)|"[^"]*")/g;
const GO_IMPORT_PATH_REGEX = /"([^"]+)"/g;

/** Known Go module paths that should be resolved - add your project's module path here */
const KNOWN_MODULE_PREFIXES = [
  'github.com/',
  'gitlab.com/',
  'bitbucket.org/',
];

/**
 * Parse import statements from source text and resolve to absolute file paths.
 * Supports deep resolution of nested dependencies (service -> repository -> model).
 * 
 * @param sourceText     Raw source code of the active file
 * @param sourceFilePath Absolute path to the active file
 * @param maxDepth       Maximum recursion depth for nested imports
 * @returns              Up to MAX_DEP_FILES unique absolute paths that exist on disk
 */
export function resolveLocalImports(
  sourceText: string,
  sourceFilePath: string,
  maxDepth = MAX_IMPORT_DEPTH,
): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  const dir = path.dirname(sourceFilePath);
  const isGoFile = sourceFilePath.endsWith('.go');

  let baseDir = dir;
  if (isGoFile) {
    const moduleRoot = findGoModuleRoot(sourceFilePath);
    if (moduleRoot) {
      baseDir = moduleRoot;
    }
  }

  // Collect all imports from source
  const importPaths = extractImports(sourceText, dir, baseDir, isGoFile);

  // BFS to resolve nested imports
  const queue: Array<{ filePath: string; depth: number }> = importPaths.map(p => ({
    filePath: p,
    depth: 1,
  }));

  while (queue.length > 0 && results.length < MAX_DEP_FILES) {
    const current = queue.shift()!;
    
    if (seen.has(current.filePath) || current.depth > maxDepth) {
      continue;
    }
    seen.add(current.filePath);

    const resolved = resolveImportPath(current.filePath, dir, baseDir, isGoFile);
    if (resolved && fs.existsSync(resolved)) {
      results.push(resolved);
      seen.add(resolved);

      // Deep dive into nested dependencies
      if (current.depth < maxDepth) {
        try {
          const nestedContent = fs.readFileSync(resolved, 'utf8');
          const nestedImports = extractImports(nestedContent, path.dirname(resolved), baseDir, resolved.endsWith('.go'));
          
          for (const nestedPath of nestedImports) {
            if (!seen.has(nestedPath) && results.length < MAX_DEP_FILES) {
              queue.push({ filePath: nestedPath, depth: current.depth + 1 });
            }
          }
        } catch {
          // Ignore read errors
        }
      }
    }
  }

  return results.slice(0, MAX_DEP_FILES);
}

/**
 * Extract all import paths from source text.
 */
function extractImports(
  sourceText: string,
  relativeTo: string,
  moduleRoot: string,
  isGoFile: boolean,
): string[] {
  const imports: string[] = [];

  if (isGoFile) {
    // Parse Go import blocks (multi-line and single-line)
    const importBlocks = sourceText.match(GO_IMPORT_REGEX) || [];
    for (const block of importBlocks) {
      let match;
      const pathRegex = new RegExp(GO_IMPORT_PATH_REGEX.source, 'g');
      while ((match = pathRegex.exec(block)) !== null) {
        const importPath = match[1];
        imports.push(resolveGoImportPath(importPath, relativeTo, moduleRoot));
      }
    }
  } else {
    // ES/CJS/CommonJS imports
    const importRegex = /(?:(?:import|export)\s[^'"]*from\s+|import\s+|require\s*\(\s*)['"](\.[^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(sourceText)) !== null) {
      const specifier = match[1];
      imports.push(path.resolve(relativeTo, specifier));
    }
  }

  return imports.filter(Boolean);
}

/**
 * Resolve a Go import path to an absolute file path.
 * Handles:
 * - Relative imports: "./internal/service"
 * - Module imports: "github.com/user/project/internal/service"
 * - Aliased imports
 */
function resolveGoImportPath(importPath: string, relativeTo: string, moduleRoot: string): string {
  // Skip standard library imports
  if (!importPath.includes('/') || importPath.startsWith('.')) {
    // Relative import - resolve from current file
    return path.resolve(relativeTo, importPath);
  }

  // Check if it's a known module prefix - try to resolve within project
  for (const prefix of KNOWN_MODULE_PREFIXES) {
    if (importPath.startsWith(prefix)) {
      // Try to resolve within module root
      const relativePath = importPath.substring(prefix.length);
      const candidate = path.join(moduleRoot, relativePath);
      if (fs.existsSync(candidate)) return candidate;
      
      // Try with /internal/ or /pkg/ patterns
      const parts = relativePath.split('/');
      const idx = parts.findIndex(p => p === 'internal' || p === 'pkg' || p === 'cmd');
      if (idx > 0) {
        const shortened = parts.slice(idx).join('/');
        const shortCandidate = path.join(moduleRoot, shortened);
        if (fs.existsSync(shortCandidate)) return shortCandidate;
      }
    }
  }

  // For unknown external imports, return as-is (will fail gracefully)
  return path.join(moduleRoot, importPath);
}

/**
 * Resolve an import path to an actual file path.
 * Returns null if path cannot be resolved.
 */
function resolveImportPath(
  importPath: string,
  relativeTo: string,
  moduleRoot: string,
  isGoFile: boolean,
): string | null {
  // Already resolved?
  if (fs.existsSync(importPath)) {
    return importPath;
  }

  // Try with .go extension for Go files
  if (isGoFile || importPath.includes('/')) {
    const goPath = importPath.endsWith('.go') ? importPath : importPath + '.go';
    if (fs.existsSync(goPath)) return goPath;
  }

  // Try relative to source file
  const relativeResolved = path.resolve(relativeTo, importPath);
  if (fs.existsSync(relativeResolved)) return relativeResolved;

  // Try relative to module root
  const moduleResolved = path.join(moduleRoot, importPath);
  if (fs.existsSync(moduleResolved)) return moduleResolved;

  // Try with common extensions
  for (const ext of EXTENSIONS) {
    if (fs.existsSync(relativeResolved + ext)) return relativeResolved + ext;
    if (fs.existsSync(moduleResolved + ext)) return moduleResolved + ext;
  }

  // Try index file
  for (const ext of EXTENSIONS) {
    const indexPath = path.join(relativeResolved, `index${ext}`);
    if (fs.existsSync(indexPath)) return indexPath;
    const indexPath2 = path.join(moduleResolved, `index${ext}`);
    if (fs.existsSync(indexPath2)) return indexPath2;
  }

  // Path could not be resolved - return null for graceful handling
  // The agent should use search_code to find the correct path
  return null;
}

/**
 * Find the Go module root by walking up directories looking for go.mod.
 */
function findGoModuleRoot(filePath: string): string | null {
  let dir = path.dirname(filePath);
  const maxWalk = 15;
  
  for (let i = 0; i < maxWalk; i++) {
    if (fs.existsSync(path.join(dir, 'go.mod'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  
  return null;
}

/**
 * Read a file and return its content and imports.
 */
export function readFileWithImports(filePath: string): { content: string; imports: string[] } | null {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const dir = path.dirname(filePath);
    const baseDir = findGoModuleRoot(filePath) || dir;
    const imports = extractImports(content, dir, baseDir, filePath.endsWith('.go'));
    return { content, imports };
  } catch {
    return null;
  }
}

/**
 * Get all nested dependencies of a file, recursively.
 * Returns map of file path -> content.
 */
export function resolveNestedDependencies(
  sourceFilePath: string,
  maxDepth = MAX_IMPORT_DEPTH,
): Map<string, string> {
  const results = new Map<string, string>();
  const queue: Array<{ filePath: string; depth: number }> = [];
  const seen = new Set<string>();

  // Start with direct imports
  const directImports = resolveLocalImports(
    fs.readFileSync(sourceFilePath, 'utf8'),
    sourceFilePath,
    1
  );

  for (const imp of directImports) {
    queue.push({ filePath: imp, depth: 1 });
  }

  // BFS through all nested dependencies
  while (queue.length > 0 && results.size < MAX_DEP_FILES) {
    const current = queue.shift()!;
    
    if (seen.has(current.filePath) || current.depth > maxDepth) continue;
    seen.add(current.filePath);

    try {
      const content = fs.readFileSync(current.filePath, 'utf8');
      results.set(current.filePath, content);

      if (current.depth < maxDepth) {
        const nestedImports = extractImports(content, path.dirname(current.filePath), findGoModuleRoot(current.filePath) || path.dirname(current.filePath), current.filePath.endsWith('.go'));
        
        for (const nestedPath of nestedImports) {
          if (!seen.has(nestedPath)) {
            const resolved = resolveImportPath(nestedPath, path.dirname(current.filePath), findGoModuleRoot(current.filePath) || path.dirname(current.filePath), current.filePath.endsWith('.go'));
            if (resolved) {
              queue.push({ filePath: resolved, depth: current.depth + 1 });
            }
          }
        }
      }
    } catch {
      // Skip files we can't read
    }
  }

  return results;
}
