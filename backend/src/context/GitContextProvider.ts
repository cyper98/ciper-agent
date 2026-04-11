import { execSync } from 'child_process';

const MAX_DIFF_CHARS = 4000;

/**
 * Retrieves the current git diff for workspace context.
 */
export function getGitDiff(workspaceRoot: string): string {
  try {
    const diff = execSync('git diff HEAD --unified=3', {
      cwd: workspaceRoot,
      timeout: 3000,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024, // 1 MB
    });
    // Truncate very large diffs
    return diff.length > MAX_DIFF_CHARS
      ? diff.slice(0, MAX_DIFF_CHARS) + '\n... (diff truncated)'
      : diff;
  } catch {
    // Not a git repo, git not installed, or no commits
    return '';
  }
}

/**
 * Gets the current branch name.
 */
export function getGitBranch(workspaceRoot: string): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: workspaceRoot,
      timeout: 1000,
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
}
