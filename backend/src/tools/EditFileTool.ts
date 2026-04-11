import * as path from 'path';
import { ToolResult } from '@ciper-agent/shared';
import { PathGuard } from '../security/PathGuard';
import { DiffApplier } from '../diff/DiffApplier';
import { MessageBridge } from '../webview/MessageBridge';
import { DiffEngine } from '../diff/DiffEngine';
import { DiffApprovalRegistry } from './DiffApprovalRegistry';

export class EditFileTool {
  constructor(
    private workspaceRoot: string,
    private pathGuard: PathGuard,
    private diffApplier: DiffApplier,
    private diffEngine: DiffEngine,
    private bridge: MessageBridge,
    private requireApproval: boolean
  ) {}

  async execute(params: { path: string; diff: string }): Promise<ToolResult> {
    try {
      const absolutePath = this.pathGuard.validate(params.path);
      const relativePath = path.relative(this.workspaceRoot, absolutePath);

      if (this.requireApproval) {
        const diffId = `diff-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        this.bridge.send({
          kind: 'DIFF_PREVIEW',
          diffId,
          path: relativePath,
          diff: params.diff,
          messageId: diffId,
        });

        // Use the shared registry — resolves when user clicks Approve/Reject
        const approved = await DiffApprovalRegistry.wait(diffId);
        if (!approved) {
          return { ok: false, error: 'User rejected the file change.' };
        }
      }

      await this.diffApplier.apply(absolutePath, params.diff);

      return {
        ok: true,
        output: `Applied patch to ${relativePath}`,
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}
