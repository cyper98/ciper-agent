import * as vscode from 'vscode';
import { DiffEngine } from './DiffEngine';

export class DiffApplier {
  constructor(private diffEngine: DiffEngine) {}

  /**
   * Apply a unified diff to a file using VSCode WorkspaceEdit.
   *
   * We open the document first so both the patch application and the
   * WorkspaceEdit operate on the exact same in-memory buffer that the
   * model read via ReadFileTool — preventing mismatches caused by
   * unsaved editor changes vs on-disk content.
   */
  async apply(absolutePath: string, patchString: string): Promise<void> {
    const uri = vscode.Uri.file(absolutePath);

    // Open (or reuse) the in-memory document — same source ReadFileTool uses
    let doc: vscode.TextDocument;
    let originalContent: string;
    try {
      doc = await vscode.workspace.openTextDocument(uri);
      originalContent = doc.getText();
    } catch {
      originalContent = '';
      // If the file doesn't exist yet, create it empty; openTextDocument will
      // succeed after WorkspaceEdit creates it below.
      doc = await vscode.workspace.openTextDocument(
        uri.with({ scheme: 'untitled' })
      );
    }

    // Try applying the patch as-is first
    let newContent = this.diffEngine.applyPatch(originalContent, patchString);

    // If strict application fails, try with fuzz: strip the unified-diff
    // headers (--- / +++ / @@) and attempt a line-by-line fuzzy apply.
    if (newContent === false) {
      newContent = this.applyFuzzy(originalContent, patchString);
    }

    if (newContent === false) {
      throw new Error(
        `Failed to apply diff to ${absolutePath}. ` +
          `The diff may not match the current file content.`
      );
    }

    // Apply via WorkspaceEdit for proper undo support
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      doc.positionAt(0),
      doc.positionAt(doc.getText().length)
    );
    edit.replace(uri, fullRange, newContent);

    const success = await vscode.workspace.applyEdit(edit);
    if (!success) {
      throw new Error(`VSCode WorkspaceEdit failed to apply changes to ${absolutePath}`);
    }

    await doc.save();
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
