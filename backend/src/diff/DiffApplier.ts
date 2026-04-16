import * as vscode from 'vscode';
import * as path from 'path';
import { DiffEngine } from './DiffEngine';

export class DiffApplier {
  constructor(private diffEngine: DiffEngine, private workspaceRoot?: string) {}

  /**
   * Apply a unified diff to a file using VSCode WorkspaceEdit.
   *
   * Handles both absolute and relative paths. If relative, resolves against workspace root.
   */
  async apply(filePath: string, patchString: string): Promise<void> {
    // Resolve to absolute path
    let absolutePath = filePath;
    
    // If not absolute, try to resolve against workspace root
    if (!path.isAbsolute(absolutePath)) {
      const wsRoot = this.workspaceRoot ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (wsRoot) {
        absolutePath = path.resolve(wsRoot, absolutePath);
      }
    }

    // Normalize path separators for the current platform
    absolutePath = path.normalize(absolutePath);

    let uri = vscode.Uri.file(absolutePath);
    
    // Check if file exists
    let doc: vscode.TextDocument;
    let originalContent: string;
    
    try {
      // First try to read via fs to check if file exists
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type === vscode.FileType.File) {
        doc = await vscode.workspace.openTextDocument(uri);
        originalContent = doc.getText();
      } else {
        throw new Error('Path is not a file');
      }
    } catch {
      // File doesn't exist - create empty content for new file
      originalContent = '';
      try {
        // Try to open as untitled for new file creation
        doc = await vscode.workspace.openTextDocument(
          uri.with({ scheme: 'untitled' })
        );
      } catch {
        // If that fails, create with a buffer
        doc = await vscode.workspace.openTextDocument({
          content: '',
          language: this.detectLanguage(absolutePath),
        });
      }
    }

    // Try applying the patch as-is first
    let newContent = this.diffEngine.applyPatch(originalContent, patchString);

    // If strict application fails, try with fuzz: strip the unified-diff
    // headers (--- / +++ / @@) and attempt a line-by-line fuzzy apply.
    if (newContent === false) {
      newContent = this.applyFuzzy(originalContent, patchString);
    }

    if (newContent === false) {
      // Final attempt: try creating new file from scratch
      if (!originalContent) {
        newContent = this.extractNewFileContent(patchString);
      }
    }

    if (newContent === false) {
      throw new Error(
        `Failed to apply diff to ${filePath}.\n` +
        `The diff may not match the current file content.\n` +
        `Path: ${absolutePath}\n` +
        `Current content length: ${originalContent.length} chars`
      );
    }

    // Apply via WorkspaceEdit for proper undo support
    const edit = new vscode.WorkspaceEdit();
    
    // Re-open the document to ensure we have latest content
    const targetDoc = await vscode.workspace.openTextDocument(uri);
    const fullRange = new vscode.Range(
      targetDoc.positionAt(0),
      targetDoc.positionAt(targetDoc.getText().length)
    );
    edit.replace(uri, fullRange, newContent);

    const success = await vscode.workspace.applyEdit(edit);
    if (!success) {
      throw new Error(`VSCode WorkspaceEdit failed to apply changes to ${filePath}`);
    }

    await targetDoc.save();
  }

  private detectLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase().slice(1);
    const langMap: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript', js: 'javascript',
      jsx: 'javascript', py: 'python', rs: 'rust', go: 'go',
      java: 'java', cs: 'csharp', cpp: 'cpp', c: 'c',
      json: 'json', md: 'markdown', css: 'css', html: 'html',
    };
    return langMap[ext] ?? 'plaintext';
  }

  private extractNewFileContent(patchString: string): string | false {
    // Extract content from a new file diff (no --- line)
    const lines = patchString.split('\n');
    const contentLines: string[] = [];
    let inContent = false;

    for (const line of lines) {
      // Skip diff headers
      if (line.startsWith('---') || line.startsWith('+++')) continue;
      if (line.startsWith('@@')) {
        inContent = true;
        continue;
      }
      if (line.startsWith('diff ') || line.startsWith('index ')) continue;
      
      if (inContent || (!line.startsWith('-') && !line.startsWith('\\'))) {
        if (line.startsWith('+')) {
          contentLines.push(line.slice(1));
        } else if (!line.startsWith('-')) {
          contentLines.push(line);
        }
      }
    }

    return contentLines.length > 0 ? contentLines.join('\n') : false;
  }

  /**
   * Fuzzy patch application: search for the removed lines anywhere in the
   * file (ignoring leading/trailing whitespace) and replace them with the
   * added lines.  Less precise than a true unified-diff apply but handles
   * the common case where the model produced correct content but wrong line
   * numbers (e.g. because context was truncated or the file was edited).
   */
  private applyFuzzy(original: string, patchString: string): string | false {
    const lines = original.split('\n');

    // Extract hunks from the patch
    const hunks = this.parseHunks(patchString);
    if (hunks.length === 0) return false;

    const result = [...lines];
    // Apply hunks in reverse order so earlier line edits don't shift indices
    for (const hunk of [...hunks].reverse()) {
      const removed = hunk.filter(l => l.startsWith('-')).map(l => l.slice(1));
      const added   = hunk.filter(l => l.startsWith('+')).map(l => l.slice(1));

      if (removed.length === 0) {
        // Pure insertion — no reliable anchor without line numbers, skip fuzzy
        continue;
      }

      // Find where removed lines appear in result (trim comparison)
      const idx = this.findBlock(result, removed);
      if (idx === -1) return false;

      result.splice(idx, removed.length, ...added);
    }

    return result.join('\n');
  }

  /** Parse each @@ hunk from a unified diff into arrays of +/- lines. */
  private parseHunks(patch: string): string[][] {
    const hunks: string[][] = [];
    let current: string[] | null = null;

    for (const line of patch.split('\n')) {
      if (line.startsWith('@@')) {
        if (current) hunks.push(current);
        current = [];
      } else if (current !== null && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
        current.push(line);
      }
    }
    if (current && current.length > 0) hunks.push(current);
    return hunks;
  }

  /** Find the first occurrence of `block` lines inside `haystack` (trimmed match). */
  private findBlock(haystack: string[], block: string[]): number {
    if (block.length === 0) return -1;
    outer: for (let i = 0; i <= haystack.length - block.length; i++) {
      for (let j = 0; j < block.length; j++) {
        if (haystack[i + j].trimEnd() !== block[j].trimEnd()) continue outer;
      }
      return i;
    }
    return -1;
  }
}
