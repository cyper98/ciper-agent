import * as path from 'path';

/**
 * Validates that file paths stay within the workspace root.
 * Prevents path traversal attacks.
 */
export class PathGuard {
  constructor(private workspaceRoot: string) {}

  /**
   * Validates a path and returns the absolute path if safe.
   * Throws if the path escapes the workspace root.
   */
  validate(filePath: string): string {
    const normalized = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(this.workspaceRoot, filePath);

    const relative = path.relative(this.workspaceRoot, normalized);

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(
        `Security: Path "${filePath}" escapes the workspace root. ` +
          `Only files within "${this.workspaceRoot}" are allowed.`
      );
    }

    return normalized;
  }

  /**
   * Returns the relative path from workspace root.
   */
  toRelative(absolutePath: string): string {
    return path.relative(this.workspaceRoot, absolutePath);
  }

  /**
   * Checks if a path is safe without throwing.
   */
  isSafe(filePath: string): boolean {
    try {
      this.validate(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
