import { LlmProvider, ChatMessage, LlmCallOptions } from '../llm/providers/LlmProvider';
import { ToolExecutor } from '../tools/ToolExecutor';
import { ParallelToolExecutor, BatchToolCall } from '../tools/parallel-tool-executor';
import { ModelRouter } from '../llm/model-router';
import { ResponseParser } from './ResponseParser';
import { RetryStrategy } from './RetryStrategy';
import { ThoughtExtractor } from './ThoughtExtractor';
import { WorkerAgent } from './worker-agent';
import { MessageBridge } from '../webview/MessageBridge';
import { ContextPayload, SubTask, WorkerResult, ToolAction, AgentActionPayload } from '@ciper-agent/shared';
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
  private parallelExecutor: ParallelToolExecutor;
  private fileEditsCount = 0;
  private editedFiles: string[] = [];

  constructor(
    private llmProvider: LlmProvider,
    private modelRouter: ModelRouter,
    private toolExecutor: ToolExecutor,
    private bridge: MessageBridge,
    private signal: AbortSignal,
    private maxIterations: number
  ) {
    this.parallelExecutor = new ParallelToolExecutor(toolExecutor);
  }

  /**
   * Run the orchestrator loop.
   * @param ragContext  Optional RAG-retrieved code context (from SemanticRetriever)
   * @returns New conversation turns to be appended to AgentRunner's history.
   */
  async run(
    userMessage: string,
    context: ContextPayload,
    priorHistory: ChatMessage[],
    ragContext = ''
  ): Promise<ChatMessage[]> {
    const baseContext =
      `Workspace root: ${context.workspaceRoot}` +
      (context.activeFile ? `\nActive file: ${context.activeFile.path}` : '') +
      (context.openFiles.length > 0
        ? `\nOpen files: ${context.openFiles.map(f => f.path).join(', ')}`
        : '') +
      ragContext;   // appended when RAG is enabled

    const contextSection = buildOrchestratorSystemPrompt(baseContext);

    const history: ChatMessage[] = [
      { role: 'system', content: contextSection },
      ...priorHistory,
      { role: 'user', content: userMessage },
    ];

    // Turns added this run — returned for AgentRunner to commit to conversation history
    const newTurns: ChatMessage[] = [{ role: 'user', content: userMessage }];
    const workerContextSnippet = buildWorkerContextSnippet(context);

    for (let iter = 0; iter < this.maxIterations; iter++) {
      if (this.signal.aborted) break;

      // Stream orchestrator response, extracting thought in real-time
      const extractor = new ThoughtExtractor();
      let rawResponse = '';
      let thoughtMsgId: string | null = null;

      for await (const token of this.llmProvider.streamChat(
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
      // Don't send STREAM_DONE here - we need to send remaining tokens first!

      const { parsed, finalResponse } = await this.retryStrategy.parseWithRetry(
        rawResponse,
        history,
        (attempt, err) => {
          // Log parse error but don't create a new UI message - it will confuse the stream
          console.warn(`Parse error attempt ${attempt}: ${err}`);
        },
        async (msgs) => {
          let r = '';
          for await (const t of this.llmProvider.streamChat(
            this.modelRouter.orchestratorModel(), msgs, this.signal, 'json', ORCHESTRATOR_LLM_OPTS
          )) r += t;
          return r;
        }
      );

      // Determine the single messageId for this response
      // Use thoughtMsgId if thought was streamed, otherwise create one
      const responseMsgId = thoughtMsgId ?? generateId();

      // NEVER send parsed.thought - it was already streamed via ThoughtExtractor
      // Sending it again creates duplicate messages

      const orchestratorTurn: ChatMessage = { role: 'assistant', content: finalResponse };

      // ── done ─────────────────────────────────────────────────────────────
      if (parsed.action.type === 'done') {
        // Add build suggestion if files were edited
        let buildSuggestion = '';
        if (this.fileEditsCount > 0) {
          buildSuggestion = this.generateBuildSuggestion();
        }
        
        // Send done message to the SAME responseMsgId (no STREAM_DONE yet)
        this.bridge.send({ kind: 'STREAM_TOKEN', token: `\n✅ ${parsed.action.message}${buildSuggestion}`, messageId: responseMsgId });
        this.bridge.send({ kind: 'STREAM_DONE', messageId: responseMsgId });
        newTurns.push(orchestratorTurn);
        return newTurns;
      }

      // ── tool call or sub_tasks ──────────────────────────────────────────
      // Send STREAM_DONE for the thought/response part
      this.bridge.send({ kind: 'STREAM_DONE', messageId: responseMsgId });
      newTurns.push(orchestratorTurn);

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
              this.llmProvider,
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
        const synthTurn: ChatMessage = {
          role: 'user',
          content: formatWorkerResults(workerResults) + truncationNote,
        };
        history.push(orchestratorTurn, synthTurn);
        newTurns.push(orchestratorTurn, synthTurn);
        continue;
      }

      // ── direct tool call (supports batch) ─────────────────────────────────
      const actions = this.extractToolActions(parsed.action);
      await this.executeToolBatch(actions, history, orchestratorTurn, newTurns);
    }

    // Hit max iterations — commit what we have
    return newTurns;
  }

  /**
   * Extract single or multiple tool actions from parsed response.
   */
  private extractToolActions(action: AgentActionPayload): ToolAction[] {
    if (action.type === 'done') return [];
    return [action as ToolAction];
  }

  /**
   * Execute tool(s) and update history with results.
   * Read-only tools are batched and executed in parallel.
   */
  private async executeToolBatch(
    actions: ToolAction[],
    history: ChatMessage[],
    orchestratorTurn: ChatMessage,
    newTurns: ChatMessage[]
  ): Promise<void> {
    if (actions.length === 0) return;

    if (actions.length === 1) {
      const toolAction = actions[0];
      const toolMsgId = generateId();
      this.bridge.send({ kind: 'TOOL_CALL', action: toolAction, messageId: toolMsgId });
      const result = await this.toolExecutor.execute(toolAction);
      this.bridge.send({ kind: 'TOOL_RESULT', result, messageId: toolMsgId });
      
      // Track file edits
      if ((toolAction.type === 'write_file' || toolAction.type === 'edit_file') && result.ok) {
        this.fileEditsCount++;
        this.editedFiles.push(toolAction.path);
      }
      
      this.addToolResultToHistory(history, newTurns, orchestratorTurn, toolAction, result);
      return;
    }

    const readOnlyActions = actions.filter(a => 
      a.type === 'read_file' || a.type === 'list_files' || a.type === 'search_code'
    );
    const writeActions = actions.filter(a => 
      a.type === 'write_file' || a.type === 'edit_file' || a.type === 'run_command'
    );

    if (readOnlyActions.length > 1) {
      const batchCalls: BatchToolCall[] = readOnlyActions.map((action, idx) => ({
        id: generateId(),
        action,
      }));

      const toolMsgId = generateId();
      this.bridge.send({ 
        kind: 'TOOL_CALL', 
        action: { type: 'batch', count: batchCalls.length } as unknown as ToolAction, 
        messageId: toolMsgId 
      });

      const results = await this.parallelExecutor.executeBatch(batchCalls);

      const toolResultsContent = results.map((r, idx) => {
        const action = readOnlyActions[idx];
        const result = r.result;
        this.bridge.send({ kind: 'TOOL_RESULT', result, messageId: r.id });
        const targetPath = this.getActionTarget(action);
        return `=== TOOL RESULT (${action.type}${targetPath ? ':' + targetPath : ''}) ===\n` +
               `Status: ${result.ok ? 'SUCCESS' : 'ERROR'}\n` +
               (result.ok ? result.output ?? '(no output)' : result.error ?? 'unknown error');
      }).join('\n\n');

      const toolResultTurn: ChatMessage = {
        role: 'user',
        content: `${toolResultsContent}\n\nNow output your next {"thought":"...","action":{...}} JSON:`,
      };
      history.push(orchestratorTurn, toolResultTurn);
      newTurns.push(orchestratorTurn, toolResultTurn);

      for (const action of writeActions) {
        const toolMsgId = generateId();
        this.bridge.send({ kind: 'TOOL_CALL', action, messageId: toolMsgId });
        const result = await this.toolExecutor.execute(action);
        this.bridge.send({ kind: 'TOOL_RESULT', result, messageId: toolMsgId });
        this.addToolResultToHistory(history, newTurns, orchestratorTurn, action, result);
      }
    } else {
      for (const action of actions) {
        const toolMsgId = generateId();
        this.bridge.send({ kind: 'TOOL_CALL', action, messageId: toolMsgId });
        const result = await this.toolExecutor.execute(action);
        this.bridge.send({ kind: 'TOOL_RESULT', result, messageId: toolMsgId });
        this.addToolResultToHistory(history, newTurns, orchestratorTurn, action, result);
      }
    }
  }

  private getActionTarget(action: ToolAction): string {
    switch (action.type) {
      case 'read_file':
      case 'write_file':
      case 'edit_file':
      case 'list_files':
        return action.path;
      case 'search_code':
        return action.query.slice(0, 50);
      case 'run_command':
        return action.command.slice(0, 30);
      default:
        return '';
    }
  }

  private addToolResultToHistory(
    history: ChatMessage[],
    newTurns: ChatMessage[],
    orchestratorTurn: ChatMessage,
    toolAction: ToolAction,
    result: { ok: boolean; output?: string; error?: string }
  ): void {
    const toolResultTurn: ChatMessage = {
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

  /**
   * Generate build/test suggestions based on project structure.
   */
  private generateBuildSuggestion(): string {
    const uniqueFiles = [...new Set(this.editedFiles)];
    const fileTypes = uniqueFiles.map(f => f.split('.').pop()?.toLowerCase() ?? '');
    
    const hasTS = fileTypes.includes('ts') || fileTypes.includes('tsx');
    const hasJS = fileTypes.includes('js') || fileTypes.includes('jsx');
    const hasPython = fileTypes.includes('py');
    const hasRust = fileTypes.includes('rs');
    
    const suggestions: string[] = [];
    
    if (hasTS || hasJS) {
      suggestions.push('npm run build', 'npm run test', 'npm run lint');
    }
    if (hasPython) {
      suggestions.push('python -m pytest', 'python -m py_compile');
    }
    if (hasRust) {
      suggestions.push('cargo build', 'cargo test');
    }
    
    if (suggestions.length === 0) {
      return '';
    }
    
    const uniqueSuggestions = [...new Set(suggestions)].slice(0, 3);
    const commands = uniqueSuggestions.map(cmd => `"${cmd}"`).join(' or ');
    
    return `\n\n💡 Tip: You may want to verify the changes by running: ${commands}`;
  }
}
