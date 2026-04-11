import { exec } from 'child_process';
import { ToolResult } from '@ciper-agent/shared';
import { CommandBlocklist } from '../security/CommandBlocklist';

const TIMEOUT_MS = 30_000; // 30 seconds
const MAX_OUTPUT_CHARS = 8000;

export class RunCommandTool {
  constructor(private workspaceRoot: string) {}

  async execute(params: { command: string; cwd?: string }): Promise<ToolResult> {
    try {
      // Security check first
      CommandBlocklist.check(params.command);

      const cwd = params.cwd || this.workspaceRoot;

      const output = await this.runCommand(params.command, cwd);
      return { ok: true, output };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  private runCommand(command: string, cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = exec(
        command,
        { cwd, timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          const output = [
            stdout && `STDOUT:\n${stdout}`,
            stderr && `STDERR:\n${stderr}`,
          ]
            .filter(Boolean)
            .join('\n');

          const truncated =
            output.length > MAX_OUTPUT_CHARS
              ? output.slice(0, MAX_OUTPUT_CHARS) + '\n... (output truncated)'
              : output;

          if (error && !stdout && !stderr) {
            reject(
              new Error(
                `Command failed with exit code ${error.code}: ${error.message}`
              )
            );
          } else if (error) {
            // Non-zero exit but has output (e.g., test failures) — return as ok with output
            resolve(truncated || `Exit code: ${error.code}`);
          } else {
            resolve(truncated || '(no output)');
          }
        }
      );

      child.on('error', reject);
    });
  }
}
