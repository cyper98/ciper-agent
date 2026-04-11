import * as path from 'path';
import * as fs from 'fs';

/** Maximum local dep files auto-included per request (keeps budget predictable). */
const MAX_DEP_FILES = 5;

/** File extensions tried when resolving a bare import specifier. */
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.go', '.rs'];

/**
 * Parse ES/CJS import statements from source text and resolve relative specifiers
 * to absolute file paths on disk. Only local paths (starting with '.' or '..') are
 * considered — npm package imports are ignored.
 *
 * @param sourceText     Raw source code of the active file
 * @param sourceFilePath Absolute path to the active file (used to resolve relative imports)
 * @returns              Up to MAX_DEP_FILES unique absolute paths that exist on disk
 */
export function resolveLocalImports(
  sourceText: string,
  sourceFilePath: string,
): string[] {
  const dir = path.dirname(sourceFilePath);
  const seen = new Set<string>();
  const results: string[] = [];

  // Matches:
  //   import ... from './foo'
  //   import './foo'
  //   require('./foo')
  //   export ... from './foo'
  const importRegex = /(?:(?:import|export)\s[^'"]*from\s+|import\s+|require\s*\(\s*)['"](\.[^'"]+)['"]/g;
  let match: RegExpExecArray | null;

  while ((match = importRegex.exec(sourceText)) !== null) {
    if (results.length >= MAX_DEP_FILES) break;

    const specifier = match[1];
    const resolved = resolveToFile(path.resolve(dir, specifier));
    if (resolved && !seen.has(resolved)) {
      seen.add(resolved);
      results.push(resolved);
    }
  }

  return results;
}

/**
 * Try common extensions to locate the actual file for a bare path.
 * Returns the absolute path if found, null otherwise.
 */
function resolveToFile(basePath: string): string | null {
  // Path already has a known extension and exists
  if (path.extname(basePath) && fs.existsSync(basePath)) {
    return basePath;
  }

  // Try appending extensions
  for (const ext of EXTENSIONS) {
    const candidate = basePath + ext;
    if (fs.existsSync(candidate)) return candidate;
  }

  // Try index file inside a directory
  for (const ext of EXTENSIONS) {
    const candidate = path.join(basePath, `index${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}
