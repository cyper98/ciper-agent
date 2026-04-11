import * as vscode from 'vscode';
import { OllamaClient, OllamaChatMessage, LlmCallOptions } from '../llm/OllamaClient';
import { ModelManager } from '../llm/ModelManager';
import { AgentStateMachine } from './AgentStateMachine';
import { ResponseParser } from './ResponseParser';
import { RetryStrategy } from './RetryStrategy';
import { ThoughtExtractor } from './ThoughtExtractor';
import { ToolExecutor } from '../tools/ToolExecutor';
import { ContextBuilder } from '../context/ContextBuilder';
import { TokenBudget } from '../context/TokenBudget';
import { buildSystemPrompt, buildChatPrompt } from '../prompts/SystemPrompt';
import { MessageBridge } from '../webview/MessageBridge';
import { DiffApprovalRegistry } from '../tools/DiffApprovalRegistry';
import { ToolAction } from '@ciper-agent/shared';

// Max conversation turns kept in memory — oldest pairs dropped beyond this limit
const MAX_HISTORY_TURNS = 20;

// LLM call options per mode — sized to actual usage to minimise KV cache allocation.
// Agent numCtx: system prompt (~1K) + context budget (8192) + MAX_HISTORY_TURNS tool results
// (up to ~12K on long runs) = ~21K peak. 24576 gives comfortable headroom without the
// full 32K waste. Chat numPredict left unlimited; agent capped at 2048 (JSON responses are bounded).
const AGENT_LLM_OPTS: LlmCallOptions = { numCtx: 24576, numPredict: 2048, keepAlive: -1 };
const CHAT_LLM_OPTS:  LlmCallOptions = { numCtx: 24576, numPredict:   -1, keepAlive: -1 };

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Format a tool result as plain-text so the model does not mirror the JSON
 * structure back as its next response.
 */
function formatToolResult(toolType: string, result: { ok: boolean; output?: string; error?: string }): string {
  const status = result.ok ? 'SUCCESS' : 'ERROR';
  const body = result.ok
    ? (result.output ?? '(no output)')
    : (result.error ?? 'unknown error');

  let hint = '';
  if (!result.ok) {
    if (result.error?.includes('ENOENT') || result.error?.includes('no such file')) {
      hint = '\nHint: The file was not found. Use list_files on the parent directory to find the correct path.';
    } else if (result.error?.includes('EACCES') || result.error?.includes('permission denied')) {
      hint = '\nHint: Permission denied. Try a different path or skip this file.';
    }
  }

  return (
    `=== TOOL RESULT (${toolType}) ===\n` +
    `Status: ${status}\n` +
    body +
    hint +
    `\n=== END TOOL RESULT ===\n\n` +
    `Now output your next {"thought":"...","action":{...}} JSON:`
  );
}

export class AgentRunner {
  private sm = new AgentStateMachine();
  private parser = new ResponseParser();
  private retryStrategy = new RetryStrategy(this.parser);
  private abortController: AbortController | null = null;
  private contextBuilder: ContextBuilder;
  // Persistent multi-turn conversation history (user+assistant turns only, no system message)
  private conversationHistory: OllamaChatMessage[] = [];

  constructor(
    private ollamaClient: OllamaClient,
    private modelManager: ModelManager,
    private toolExecutor: ToolExecutor,
    private bridge: MessageBridge,
    private workspaceRoot: string
  ) {
    const budget = new TokenBudget(
      vscode.workspace
        .getConfiguration('ciperAgent')
        .get<number>('contextTokenBudget', 8192)
    );
    this.contextBuilder = new ContextBuilder(budget);

    // Propagate state changes to the webview
    this.sm.onStateChange((state, detail) => {
      this.bridge.send({ kind: 'AGENT_STATE', state, detail });
    });
  }

  isRunning(): boolean {
    return !this.sm.isIdle();
  }

  cancel(): void {
    this.abortController?.abort();
    this.sm.reset();
    this.bridge.send({ kind: 'AGENT_STATE', state: 'IDLE', detail: 'Cancelled by user' });
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }

  /** Drop oldest turns when history exceeds MAX_HISTORY_TURNS pairs. */
  private pruneHistory(): void {
    const maxMessages = MAX_HISTORY_TURNS * 2;
    if (this.conversationHistory.length > maxMessages) {
      this.conversationHistory = this.conversationHistory.slice(-maxMessages);
    }
  }

  approveDiff(diffId: string): void {
    DiffApprovalRegistry.resolve(diffId, true);
  }

  rejectDiff(diffId: string): void {
    DiffApprovalRegistry.resolve(diffId, false);
  }

  async runChat(userMessage: string, attachedFiles?: string[]): Promise<void> {
    if (!this.sm.isIdle()) {
      this.bridge.send({
        kind: 'STREAM_ERROR',
        error: 'Agent is already running. Stop it first.',
        messageId: generateId(),
      });
      return;
    }

    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const messageId = generateId();

    try {
      this.sm.transition('PLAN');

      const context = await this.contextBuilder.build({
        workspaceRoot: this.workspaceRoot,
        selectedText: this.getSelectedText(),
        attachedFiles,
      });

      this.bridge.send({
        kind: 'CONTEXT_INFO',
        tokenCount: context.tokenCount,
        budget: 8192,
      });

      // Chat mode uses a conversational prompt — no JSON output rules
      const systemPrompt = buildChatPrompt(context, this.contextBuilder);
      // Fresh system message each call so context reflects current workspace state,
      // followed by the full accumulated conversation history.
      const messages: OllamaChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...this.conversationHistory,
        { role: 'user', content: userMessage },
      ];

      this.sm.transition('ACT');

      let fullResponse = '';
      for await (const token of this.ollamaClient.streamChat(
        this.modelManager.getSelectedModel(),
        messages,
        signal,
        undefined,
        CHAT_LLM_OPTS
      )) {
        fullResponse += token;
        this.bridge.send({ kind: 'STREAM_TOKEN', token, messageId });
      }

      this.bridge.send({ kind: 'STREAM_DONE', messageId });

      // Persist this turn into conversation history and prune if needed
      this.conversationHistory.push(
        { role: 'user', content: userMessage },
        { role: 'assistant', content: fullResponse }
      );
      this.pruneHistory();

      this.sm.transition('OBSERVE');
      this.sm.transition('REFLECT');
      this.sm.transition('DONE');
    } catch (err) {
      if ((err as Error).message === 'Request aborted') return;
      this.bridge.send({
        kind: 'STREAM_ERROR',
        error: (err as Error).message,
        messageId,
      });
      this.sm.transition('ERROR');
    } finally {
      this.sm.reset();
      this.abortController = null;
    }
  }

  async runAgent(userMessage: string, attachedFiles?: string[]): Promise<void> {
    if (!this.sm.isIdle()) {
      this.bridge.send({
        kind: 'STREAM_ERROR',
        error: 'Agent is already running. Stop it first.',
        messageId: generateId(),
      });
      return;
    }

    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const maxIterations = vscode.workspace
      .getConfiguration('ciperAgent')
      .get<number>('maxAgentIterations', 20);

    // Track new turns added this agent run — persisted to conversationHistory at the end.
    // Declared outside try so the finally block can't accidentally double-push.
    const newTurns: OllamaChatMessage[] = [
      { role: 'user', content: userMessage },
    ];
    let historyCommitted = false;

    try {
      this.sm.transition('PLAN');

      const context = await this.contextBuilder.build({
        workspaceRoot: this.workspaceRoot,
        selectedText: this.getSelectedText(),
        attachedFiles,
      });

      this.bridge.send({
        kind: 'CONTEXT_INFO',
        tokenCount: context.tokenCount,
        budget: 8192,
      });

      const systemPrompt = buildSystemPrompt(context, this.contextBuilder);
      const history: OllamaChatMessage[] = [
        { role: 'system', content: systemPrompt },
        ...this.conversationHistory,
        { role: 'user', content: userMessage },
      ];

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        if (signal.aborted) break;

        this.sm.transition('ACT');

        // Stream the LLM response while extracting the "thought" field incrementally
        // so the user sees it in real-time instead of waiting for the full JSON.
        const extractor = new ThoughtExtractor();
        let rawResponse = '';
        let thoughtMsgId: string | null = null;

        for await (const token of this.ollamaClient.streamChat(
          this.modelManager.getSelectedModel(),
          history,
          signal,
          'json',
          AGENT_LLM_OPTS
        )) {
          rawResponse += token;
          const chars = extractor.push(token);
          if (chars !== null) {
            if (!thoughtMsgId) { thoughtMsgId = generateId(); }
            this.bridge.send({ kind: 'STREAM_TOKEN', token: chars, messageId: thoughtMsgId });
          }
        }
        if (thoughtMsgId) {
          this.bridge.send({ kind: 'STREAM_DONE', messageId: thoughtMsgId });
        }

        this.sm.transition('OBSERVE');

        // Parse with retry. Returns both the parsed result AND the finalResponse string
        // that actually parsed (may differ from rawResponse if a retry was needed).
        const { parsed, finalResponse } = await this.retryStrategy.parseWithRetry(
          rawResponse,
          history,
          (attempt, error) => {
            const retryId = generateId();
            this.bridge.send({
              kind: 'STREAM_TOKEN',
              token: `⚠️ Parse error (attempt ${attempt}): ${error}\nRetrying...\n`,
              messageId: retryId,
            });
            this.bridge.send({ kind: 'STREAM_DONE', messageId: retryId });
          },
          async (messages) => {
            let response = '';
            for await (const token of this.ollamaClient.streamChat(
              this.modelManager.getSelectedModel(),
              messages,
              signal,
              'json',
              AGENT_LLM_OPTS
            )) {
              response += token;
            }
            return response;
          }
        );

        // Only send thought if streaming extraction didn't already deliver it
        if (!thoughtMsgId) {
          const thoughtId = generateId();
          this.bridge.send({ kind: 'STREAM_TOKEN', token: parsed.thought, messageId: thoughtId });
          this.bridge.send({ kind: 'STREAM_DONE', messageId: thoughtId });
        }

        // Check if done
        if (parsed.action.type === 'done') {
          const doneId = generateId();
          this.bridge.send({ kind: 'STREAM_TOKEN', token: `✅ ${parsed.action.message}`, messageId: doneId });
          this.bridge.send({ kind: 'STREAM_DONE', messageId: doneId });
          // Use finalResponse (valid JSON) not rawResponse (may be broken)
          newTurns.push({ role: 'assistant', content: finalResponse });
          this.conversationHistory.push(...newTurns);
          this.pruneHistory();
          historyCommitted = true;
          this.sm.transition('REFLECT');
          this.sm.transition('DONE');
          break;
        }

        // Execute tool
        const toolAction = parsed.action as ToolAction;
        const toolMsgId = generateId();
        this.bridge.send({ kind: 'TOOL_CALL', action: toolAction, messageId: toolMsgId });
        const result = await this.toolExecutor.execute(toolAction);
        this.bridge.send({ kind: 'TOOL_RESULT', result, messageId: toolMsgId });

        // Append to in-loop history AND newTurns using finalResponse (not rawResponse)
        const assistantTurn: OllamaChatMessage = { role: 'assistant', content: finalResponse };
        const toolResultTurn: OllamaChatMessage = {
          role: 'user',
          content: formatToolResult(toolAction.type, result),
        };
        history.push(assistantTurn, toolResultTurn);
        newTurns.push(assistantTurn, toolResultTurn);

        this.sm.transition('REFLECT');
        this.sm.transition('PLAN');
      }

      // Persist turns if the loop ended without a 'done' action (hit maxIterations)
      if (!historyCommitted) {
        this.conversationHistory.push(...newTurns);
        this.pruneHistory();
      }
    } catch (err) {
      if ((err as Error).message === 'Request aborted') return;
      const errId = generateId();
      this.bridge.send({
        kind: 'STREAM_ERROR',
        error: (err as Error).message,
        messageId: errId,
      });
      // Intentionally do NOT commit newTurns on error — the model never completed the task,
      // so partial tool-result turns would confuse the next run. The user retries from a clean slate.
      this.sm.transition('ERROR');
    } finally {
      this.sm.reset();
      this.abortController = null;
    }
  }

  private getSelectedText(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return undefined;
    const selection = editor.selection;
    if (selection.isEmpty) return undefined;
    return editor.document.getText(selection);
  }
}
