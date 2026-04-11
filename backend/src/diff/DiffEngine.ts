import * as diff from 'diff';

export class DiffEngine {
  /**
   * Create a unified diff between old and new content.
   */
  createDiff(filePath: string, oldContent: string, newContent: string): string {
    return diff.createPatch(filePath, oldContent, newContent, 'original', 'modified', {
      context: 3,
    });
  }

  /**
   * Create a diff for a new file (no old content).
   */
  createNewFileDiff(filePath: string, content: string): string {
    return diff.createPatch(filePath, '', content, 'original', 'new file', { context: 3 });
  }

  /**
   * Apply a patch string to original content, returning the new content.
   */
  applyPatch(originalContent: string, patchString: string): string | false {
    return diff.applyPatch(originalContent, patchString);
  }

  /**
   * Check if content needs to be changed (diff is non-trivial).
   */
  hasChanges(oldContent: string, newContent: string): boolean {
    const d = diff.diffLines(oldContent, newContent);
    return d.some(part => part.added || part.removed);
  }
}
