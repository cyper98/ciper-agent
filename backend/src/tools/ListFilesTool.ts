import * as vscode from 'vscode';
import * as path from 'path';
import { ToolResult } from '@ciper-agent/shared';
import { PathGuard } from '../security/PathGuard';

export class ListFilesTool {
  constructor(
    private workspaceRoot: string,
    private pathGuard: PathGuard
  ) {}

  async execute(params: { path: string }): Promise<ToolResult> {
    try {
      const absolutePath = this.pathGuard.validate(params.path);
      const dirUri = vscode.Uri.file(absolutePath);

      const entries = await vscode.workspace.fs.readDirectory(dirUri);
      const sorted = entries.sort(([, aType], [, bType]) => {
        // Directories first
        if (aType === vscode.FileType.Directory && bType !== vscode.FileType.Directory) return -1;
        if (aType !== vscode.FileType.Directory && bType === vscode.FileType.Directory) return 1;
        return 0;
      });

      const lines: string[] = [];
      for (const [name, fileType] of sorted) {
        const isDir = fileType === vscode.FileType.Directory;
        lines.push(`${isDir ? '[DIR] ' : '      '}${name}`);
      }

      const relPath = path.relative(this.workspaceRoot, absolutePath) || '.';
      return {
        ok: true,
        output: `Directory: ${relPath}\n${lines.join('\n')}`,
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}
