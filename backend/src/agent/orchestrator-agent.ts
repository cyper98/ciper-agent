import { OllamaClient, OllamaChatMessage, LlmCallOptions } from '../llm/OllamaClient';
import { ToolExecutor } from '../tools/ToolExecutor';
import { ModelRouter } from '../llm/model-router';
import { ResponseParser } from './ResponseParser';
import { RetryStrategy } from './RetryStrategy';
import { ThoughtExtractor } from './ThoughtExtractor';
import { WorkerAgent } from './worker-agent';
import { MessageBridge } from '../webview/MessageBridge';
import { ContextPayload, SubTask, WorkerResult, ToolAction } from '@ciper-agent/shared';
import { buildOrchestratorSystemPrompt } from '../prompts/templates/orchestrator';

const ORCHESTRATOR_LLM_OPTS: LlmCallOptions = {
  numCtx: 24576,
  numPredict: 2048,
  keepAlive: -1,
};

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Format aggregated worker results as the next user turn for the orchestrator. */
function formatWorkerResults(results: WorkerResult[]): string {
  const parts = results.map(r =>
    `[Worker ${r.taskId}] ${r.ok ? '✅' : '❌'} ${r.summary}` +
    (r.toolResults.length > 0
      ? `\nTools used: ${r.toolResults.map(t => t.tool).join(', ')}`
      : '')
  );
  return (
    `Worker results:\n${parts.join('\n\n')}\n\n` +
    `Now synthesize these results and decide your next action.`
  );
}

/** Compact context section for workers (to keep their numCtx small). */
function buildWorkerContextSnippet(ctx: ContextPayload): string {
  const lines = [`Workspace: ${ctx.workspaceRoot}`];
  if (ctx.activeFile) lines.push(`Active file: ${ctx.activeFile.path}`);
  ctx.openFiles.slice(0, 3).forEach(f => lines.push(`Open: ${f.path}`));
  return lines.join('\n');
}

/**
 * Orchestrator (circler) agent.
 * Replaces the inner iteration loop in AgentRunner for agent-mode requests.
 * Handles three action types:
 *   - sub_tasks → spawn WorkerAgent instances concurrently via Promise.all
 *   - <tool>    → execute directly (identical to original AgentRunner behavior)
 *   - done      → finish and return accumulated turns
 */
export class OrchestratorAgent {
  private parser = new ResponseParser();
  private retryStrategy = new RetryStrategy(this.parser);

  constructor(
    private ollamaClient: OllamaClient,
    private modelRouter: ModelRouter,
    private toolExecutor: ToolExecutor,
    private bridge: MessageBridge,
    private signal: AbortSignal,
    private maxIterations: number
  ) {}

  /**
   * Run the orchestrator loop.
   * @param ragContext  Optional RAG-retrieved code context (from SemanticRetriever)
   * @returns New conversation turns to be appended to AgentRunner's history.
   */
  async run(
    userMessage: string,
    context: ContextPayload,
    priorHistory: OllamaChatMessage[],
    ragContext = ''
  ): Promise<OllamaChatMessage[]> {
    const baseContext =
      `Workspace root: ${context.workspaceRoot}` +
      (context.activeFile ? `\nActive file: ${context.activeFile.path}` : '') +
      (context.openFiles.length > 0
        ? `\nOpen files: ${context.openFiles.map(f => f.path).join(', ')}`
        : '') +
      ragContext;   // appended when RAG is enabled

    const contextSection = buildOrchestratorSystemPrompt(baseContext);

    const history: OllamaChatMessage[] = [
      { role: 'system', content: contextSection },
      ...priorHistory,
      { role: 'user', content: userMessage },
    ];

    // Turns added this run — returned for AgentRunner to commit to conversation history
    const newTurns: OllamaChatMessage[] = [{ role: 'user', content: userMessage }];
    const workerContextSnippet = buildWorkerContextSnippet(context);

    for (let iter = 0; iter < this.maxIterations; iter++) {
      if (this.signal.aborted) break;

      // Stream orchestrator response, extracting thought in real-time
      const extractor = new ThoughtExtractor();
      let rawResponse = '';
      let thoughtMsgId: string | null = null;

      for await (const token of this.ollamaClient.streamChat(
        this.modelRouter.orchestratorModel(),
        history,
        this.signal,
        'json',
        ORCHESTRATOR_LLM_OPTS
      )) {
        rawResponse += token;
        const chars = extractor.push(token);
        if (chars !== null) {
          if (!thoughtMsgId) thoughtMsgId = generateId();
          this.bridge.send({ kind: 'STREAM_TOKEN', token: chars, messageId: thoughtMsgId });
        }
      }
      if (thoughtMsgId) this.bridge.send({ kind: 'STREAM_DONE', messageId: thoughtMsgId });

      const { parsed, finalResponse } = await this.retryStrategy.parseWithRetry(
        rawResponse,
        history,
        (attempt, err) => {
          const id = generateId();
          this.bridge.send({ kind: 'STREAM_TOKEN', token: `⚠️ Parse error (attempt ${attempt}): ${err}\n`, messageId: id });
          this.bridge.send({ kind: 'STREAM_DONE', messageId: id });
        },
        async (msgs) => {
          let r = '';
          for await (const t of this.ollamaClient.streamChat(
            this.modelRouter.orchestratorModel(), msgs, this.signal, 'json', ORCHESTRATOR_LLM_OPTS
          )) r += t;
          return r;
        }
      );

      // Emit thought if streaming didn't deliver it
      if (!thoughtMsgId) {
        const id = generateId();
        this.bridge.send({ kind: 'STREAM_TOKEN', token: parsed.thought, messageId: id });
        this.bridge.send({ kind: 'STREAM_DONE', messageId: id });
      }

      const orchestratorTurn: OllamaChatMessage = { role: 'assistant', content: finalResponse };

      // ── done ─────────────────────────────────────────────────────────────
      if (parsed.action.type === 'done') {
        const doneId = generateId();
        this.bridge.send({ kind: 'STREAM_TOKEN', token: `✅ ${parsed.action.message}`, messageId: doneId });
        this.bridge.send({ kind: 'STREAM_DONE', messageId: doneId });
        newTurns.push(orchestratorTurn);
        return newTurns;
      }

      // ── sub_tasks — spawn workers in parallel ────────────────────────────
      if (parsed.action.type === 'sub_tasks') {
        const allTasks: SubTask[] = parsed.action.tasks;
        const maxWorkers = this.modelRouter.maxWorkerAgents();
        const tasks = allTasks.slice(0, maxWorkers);
        const dropped = allTasks.length - tasks.length;

        // Notify UI: plan received
        const planMsgId = generateId();
        this.bridge.send({ kind: 'ORCHESTRATOR_PLAN', tasks, messageId: planMsgId });

        // Notify UI: each worker spawning
        tasks.forEach(t => {
          this.bridge.send({
            kind: 'WORKER_SPAWNED',
            taskId: t.id,
            description: t.description,
            messageId: generateId(),
          });
        });

        // Run all workers concurrently; allSettled ensures one failure doesn't kill siblings
        const settled = await Promise.allSettled(
          tasks.map(task => {
            const worker = new WorkerAgent(
              this.ollamaClient,
              this.modelRouter.workerModel(),
              this.modelRouter.workerNumCtx(),
              this.toolExecutor,
              this.signal
            );
            return worker.run(task, workerContextSnippet);
          })
        );

        const workerResults: WorkerResult[] = settled.map((s, i) =>
          s.status === 'fulfilled'
            ? s.value
            : {
                taskId: tasks[i].id,
                ok: false,
                summary: 'Worker threw unexpectedly',
                toolResults: [],
                error: String((s as PromiseRejectedResult).reason),
              }
        );

        // Notify UI: each worker done
        workerResults.forEach(r => {
          this.bridge.send({
            kind: 'WORKER_DONE',
            taskId: r.taskId,
            summary: r.summary,
            ok: r.ok,
            messageId: generateId(),
          });
        });

        // Feed synthesized results back as next user turn
        const truncationNote = dropped > 0
          ? `\nNote: ${dropped} additional task(s) were not run (maxWorkerAgents limit). Consider re-planning them.`
          : '';
        const synthTurn: OllamaChatMessage = {
          role: 'user',
          content: formatWorkerResults(workerResults) + truncationNote,
        };
        history.push(orchestratorTurn, synthTurn);
        newTurns.push(orchestratorTurn, synthTurn);
        continue;
      }

      // ── direct tool call ─────────────────────────────────────────────────
      const toolAction = parsed.action as ToolAction;
      const toolMsgId = generateId();
      this.bridge.send({ kind: 'TOOL_CALL', action: toolAction, messageId: toolMsgId });
      const result = await this.toolExecutor.execute(toolAction);
      this.bridge.send({ kind: 'TOOL_RESULT', result, messageId: toolMsgId });

      const toolResultTurn: OllamaChatMessage = {
        role: 'user',
        content:
          `=== TOOL RESULT (${toolAction.type}) ===\n` +
          `Status: ${result.ok ? 'SUCCESS' : 'ERROR'}\n` +
          (result.ok ? result.output ?? '(no output)' : result.error ?? 'unknown error') +
          `\n=== END TOOL RESULT ===\n\nNow output your next {"thought":"...","action":{...}} JSON:`,
      };
      history.push(orchestratorTurn, toolResultTurn);
      newTurns.push(orchestratorTurn, toolResultTurn);
    }

    // Hit max iterations — commit what we have
    return newTurns;
  }
}
