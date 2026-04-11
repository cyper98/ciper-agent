import * as vscode from 'vscode';
import * as path from 'path';
import { ToolResult } from '@ciper-agent/shared';
import { PathGuard } from '../security/PathGuard';

export class ReadFileTool {
  constructor(
    private workspaceRoot: string,
    private pathGuard: PathGuard
  ) {}

  async execute(params: { path: string }): Promise<ToolResult> {
    try {
      const absolutePath = this.pathGuard.validate(params.path);
      const uri = vscode.Uri.file(absolutePath);

      // Use VSCode API to read (works with remote workspaces)
      let text: string;
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        text = doc.getText();
      } catch {
        // Fallback for binary or inaccessible files
        const bytes = await vscode.workspace.fs.readFile(uri);
        text = Buffer.from(bytes).toString('utf-8');
      }

      const relativePath = path.relative(this.workspaceRoot, absolutePath);
      const lineCount = text.split('\n').length;

      return {
        ok: true,
        output: `File: ${relativePath} (${lineCount} lines)\n\`\`\`\n${text}\n\`\`\``,
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}
