import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const MAX_DIFF_CHARS = 4000;

/**
 * Retrieves the current git diff for workspace context.
 * Async — does not block the Node.js event loop.
 */
export async function getGitDiff(workspaceRoot: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['diff', 'HEAD', '--unified=3'], {
      cwd: workspaceRoot,
      timeout: 3000,
      maxBuffer: 1024 * 1024, // 1 MB
    });
    return stdout.length > MAX_DIFF_CHARS
      ? stdout.slice(0, MAX_DIFF_CHARS) + '\n... (diff truncated)'
      : stdout;
  } catch {
    // Not a git repo, git not installed, or no commits
    return '';
  }
}

/**
 * Gets the current branch name.
 * Async — does not block the Node.js event loop.
 */
export async function getGitBranch(workspaceRoot: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: workspaceRoot,
      timeout: 1000,
    });
    return stdout.trim();
  } catch {
    return '';
  }
}
