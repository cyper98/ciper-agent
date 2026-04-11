import * as vscode from 'vscode';
import * as path from 'path';

export interface RankedFile {
  uri: vscode.Uri;
  relativePath: string;
  score: number;
}

/**
 * Ranks workspace files by relevance to the current context.
 * Higher score = more relevant = included first within token budget.
 */
export class FileRanker {
  async rankFiles(
    workspaceRoot: string,
    activeFileUri?: vscode.Uri
  ): Promise<RankedFile[]> {
    // Get all workspace files (exclude node_modules, dist, .git, etc.)
    const uris = await vscode.workspace.findFiles(
      '**/*.{ts,tsx,js,jsx,py,go,rs,java,cpp,c,h,cs,rb,php,swift,kt,md,json,yaml,yml}',
      '{**/node_modules/**,**/dist/**,**/.git/**,**/out/**,**/build/**,**/__pycache__/**}'
    );

    // Get recently modified files from open editors
    const openEditorPaths = new Set(
      vscode.window.visibleTextEditors.map(e => e.document.uri.fsPath)
    );

    // Parse imports from active file
    const activeFileImports = activeFileUri
      ? await this.getImportedBasenames(activeFileUri)
      : new Set<string>();

    const activeDir = activeFileUri
      ? path.dirname(activeFileUri.fsPath)
      : workspaceRoot;

    // Score each file
    const scored: RankedFile[] = uris.map(uri => {
      let score = 0;
      const fsPath = uri.fsPath;
      const basename = path.basename(fsPath, path.extname(fsPath));

      // Currently visible in editor
      if (openEditorPaths.has(fsPath)) score += 20;

      // Same directory as active file
      if (path.dirname(fsPath) === activeDir) score += 5;

      // Active file imports this file
      if (activeFileImports.has(basename)) score += 15;

      // Prefer source files over config/test files
      if (fsPath.includes('.test.') || fsPath.includes('.spec.')) score -= 3;
      if (fsPath.includes('node_modules')) score -= 50;

      // Prefer TypeScript/JavaScript source
      const ext = path.extname(fsPath);
      if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) score += 2;

      return {
        uri,
        relativePath: path.relative(workspaceRoot, fsPath),
        score,
      };
    });

    // Sort by score descending
    return scored.sort((a, b) => b.score - a.score);
  }

  private async getImportedBasenames(fileUri: vscode.Uri): Promise<Set<string>> {
    const basenames = new Set<string>();
    try {
      const doc = await vscode.workspace.openTextDocument(fileUri);
      const text = doc.getText();
      // Match: import ... from './something' or require('./something')
      const importRegex = /(?:import\s+.*?from\s+|require\s*\()['"]([^'"]+)['"]/g;
      let match: RegExpExecArray | null;
      while ((match = importRegex.exec(text)) !== null) {
        const importPath = match[1];
        const basename = path.basename(importPath, path.extname(importPath));
        basenames.add(basename);
      }
    } catch {
      // Ignore errors reading active file
    }
    return basenames;
  }
}
