import * as vscode from 'vscode';
import * as path from 'path';
import { ToolResult } from '@ciper-agent/shared';
import { PathGuard } from '../security/PathGuard';
import { DiffEngine } from '../diff/DiffEngine';
import { DiffApplier } from '../diff/DiffApplier';
import { MessageBridge } from '../webview/MessageBridge';
import { DiffApprovalRegistry } from './DiffApprovalRegistry';

export class WriteFileTool {
  constructor(
    private workspaceRoot: string,
    private pathGuard: PathGuard,
    private diffEngine: DiffEngine,
    private diffApplier: DiffApplier,
    private bridge: MessageBridge,
    private requireApproval: boolean
  ) {}

  async execute(params: { path: string; content: string }): Promise<ToolResult> {
    try {
      const absolutePath = this.pathGuard.validate(params.path);
      const relativePath = path.relative(this.workspaceRoot, absolutePath);

      let diff: string;
      let oldContent = '';

      try {
        const uri = vscode.Uri.file(absolutePath);
        const bytes = await vscode.workspace.fs.readFile(uri);
        oldContent = Buffer.from(bytes).toString('utf-8');
        diff = this.diffEngine.createDiff(relativePath, oldContent, params.content);
      } catch {
        // New file
        diff = this.diffEngine.createNewFileDiff(relativePath, params.content);
        oldContent = '';
      }

      if (this.requireApproval) {
        const diffId = `diff-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        this.bridge.send({
          kind: 'DIFF_PREVIEW',
          diffId,
          path: relativePath,
          diff,
          messageId: diffId,
        });

        const approved = await DiffApprovalRegistry.wait(diffId);
        if (!approved) {
          return { ok: false, error: 'User rejected the file change.' };
        }
      }

      const uri = vscode.Uri.file(absolutePath);
      const encoder = new TextEncoder();
      await vscode.workspace.fs.writeFile(uri, encoder.encode(params.content));

      return {
        ok: true,
        output: `Wrote ${relativePath} (${params.content.split('\n').length} lines)`,
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /** Kept for backwards compat — delegates to registry. */
  static resolveDiff(diffId: string, approved: boolean): void {
    DiffApprovalRegistry.resolve(diffId, approved);
  }
}
