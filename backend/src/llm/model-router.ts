import * as vscode from 'vscode';
import { ModelManager } from './ModelManager';

/**
 * Routes LLM calls to the appropriate model based on agent role.
 * Reads VSCode settings on each call so live config changes take effect immediately.
 *
 * Design: no auto VRAM detection — user sets models explicitly in settings.
 * More VRAM → bigger models → better quality. Smaller machines use 3b models.
 */
export class ModelRouter {
  constructor(private modelManager: ModelManager) {}

  /** Primary model: used by the orchestrator for planning and synthesis. */
  orchestratorModel(): string {
    const cfg = vscode.workspace.getConfiguration('ciperAgent');
    return cfg.get<string>('orchestratorModel', '').trim() || this.modelManager.getSelectedModel();
  }

  /** Lightweight model: used by workers for focused single-task execution. */
  workerModel(): string {
    const cfg = vscode.workspace.getConfiguration('ciperAgent');
    return cfg.get<string>('workerModel', '').trim() || this.modelManager.getSelectedModel();
  }

  /**
   * KV cache slots allocated per worker agent.
   * Default 8192. Set to 4096 on 4 GB VRAM machines to keep memory usage low.
   * Workers handle focused sub-tasks with short tool-call chains — they rarely need large context.
   */
  workerNumCtx(): number {
    const cfg = vscode.workspace.getConfiguration('ciperAgent');
    return cfg.get<number>('workerNumCtx', 8192);
  }

  /** Max concurrent worker agents. Lower on constrained machines. */
  maxWorkerAgents(): number {
    const cfg = vscode.workspace.getConfiguration('ciperAgent');
    return cfg.get<number>('maxWorkerAgents', 4);
  }
}
