import { LlmProvider, ChatMessage, LlmCallOptions } from '../llm/providers/LlmProvider';
import { ToolExecutor } from '../tools/ToolExecutor';
import { ResponseParser } from './ResponseParser';
import { RetryStrategy } from './RetryStrategy';
import { SubTask, WorkerResult, ToolAction } from '@ciper-agent/shared';
import { buildWorkerSystemPrompt, MAX_WORKER_ITERATIONS } from '../prompts/templates/worker';

/**
 * Lightweight single-task agent.
 * Runs an isolated PLAN→ACT→OBSERVE loop for one SubTask and returns a WorkerResult.
 * Workers are stateless — no conversation history, no diff approvals, narrow context window.
 */
export class WorkerAgent {
  private parser = new ResponseParser();
  private retryStrategy = new RetryStrategy(this.parser);

  constructor(
    private llmProvider: LlmProvider,
    private model: string,
    private numCtx: number,   // from ModelRouter.workerNumCtx() — 4096 on 4 GB, 8192 otherwise
    private toolExecutor: ToolExecutor,
    private signal: AbortSignal
  ) {}

  async run(task: SubTask, contextSnippet: string): Promise<WorkerResult> {
    const opts: LlmCallOptions = { numCtx: this.numCtx, numPredict: 1024, keepAlive: -1 };
    const systemPrompt = buildWorkerSystemPrompt(task.description, contextSnippet);

    const history: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: task.hint ?? `Begin your task: ${task.description}` },
    ];

    const toolResults: WorkerResult['toolResults'] = [];

    try {
      for (let i = 0; i < MAX_WORKER_ITERATIONS; i++) {
        if (this.signal.aborted) {
          return { taskId: task.id, ok: false, summary: 'Cancelled', toolResults, error: 'aborted' };
        }

        // Collect full LLM response (workers don't stream thought to UI)
        let rawResponse = '';
        for await (const token of this.llmProvider.streamChat(
          this.model, history, this.signal, 'json', opts
        )) {
          rawResponse += token;
        }

        const { parsed, finalResponse } = await this.retryStrategy.parseWithRetry(
          rawResponse,
          history,
          () => { /* silent retries — workers don't emit to bridge */ },
          async (msgs) => {
            let r = '';
            for await (const t of this.llmProvider.streamChat(this.model, msgs, this.signal, 'json', opts)) {
              r += t;
            }
            return r;
          }
        );

        if (parsed.action.type === 'done') {
          return {
            taskId: task.id,
            ok: true,
            summary: parsed.action.message,
            toolResults,
          };
        }

        const toolAction = parsed.action as ToolAction;
        const result = await this.toolExecutor.execute(toolAction);
        toolResults.push({
          tool: toolAction.type,
          output: result.ok ? (result.output ?? '') : `ERROR: ${result.error ?? 'unknown'}`,
        });

        history.push(
          { role: 'assistant', content: finalResponse },
          {
            role: 'user',
            content:
              `TOOL RESULT (${toolAction.type}): ` +
              (result.ok ? result.output : `ERROR: ${result.error}`) +
              '\nContinue with your goal.',
          }
        );
      }

      return {
        taskId: task.id,
        ok: false,
        summary: `Hit iteration limit (${MAX_WORKER_ITERATIONS}) without completing task`,
        toolResults,
      };
    } catch (err) {
      const message = (err as Error).message;
      if (message === 'Request aborted') {
        return { taskId: task.id, ok: false, summary: 'Cancelled', toolResults, error: 'aborted' };
      }
      return { taskId: task.id, ok: false, summary: 'Worker error', toolResults, error: message };
    }
  }
}
