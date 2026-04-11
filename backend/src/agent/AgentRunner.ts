import * as vscode from 'vscode';
import { OllamaClient, OllamaChatMessage, LlmCallOptions } from '../llm/OllamaClient';
import { ModelManager } from '../llm/ModelManager';
import { ModelRouter } from '../llm/model-router';
import { AgentStateMachine } from './AgentStateMachine';
import { OrchestratorAgent } from './orchestrator-agent';
import { ToolExecutor } from '../tools/ToolExecutor';
import { ContextBuilder } from '../context/ContextBuilder';
import { TokenBudget } from '../context/TokenBudget';
import { buildChatPrompt } from '../prompts/SystemPrompt';
import { MessageBridge } from '../webview/MessageBridge';
import { DiffApprovalRegistry } from '../tools/DiffApprovalRegistry';
import { SemanticRetriever } from '../context/semantic-retriever';

// Max conversation turns kept in memory — oldest pairs dropped beyond this limit
const MAX_HISTORY_TURNS = 20;

// Chat mode LLM options — unlimited prediction, large context for conversation history
const CHAT_LLM_OPTS: LlmCallOptions = { numCtx: 24576, numPredict: -1, keepAlive: -1 };

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}


export class AgentRunner {
  private sm = new AgentStateMachine();
  private abortController: AbortController | null = null;
  private contextBuilder: ContextBuilder;
  // Persistent multi-turn conversation history (user+assistant turns only, no system message)
  private conversationHistory: OllamaChatMessage[] = [];

  constructor(
    private ollamaClient: OllamaClient,
    private modelManager: ModelManager,
    private modelRouter: ModelRouter,
    private toolExecutor: ToolExecutor,
    private bridge: MessageBridge,
    private workspaceRoot: string,
    private semanticRetriever?: SemanticRetriever  // optional — only present when ragEnabled
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

      this.sm.transition('ACT');

      // Retrieve semantically relevant context if RAG is enabled
      let ragContext = '';
      if (this.semanticRetriever) {
        const retrieved = await this.semanticRetriever.retrieve(userMessage, signal);
        ragContext = this.semanticRetriever.formatAsContext(retrieved);
      }

      // Delegate the full iteration loop to the OrchestratorAgent
      const orchestrator = new OrchestratorAgent(
        this.ollamaClient,
        this.modelRouter,
        this.toolExecutor,
        this.bridge,
        signal,
        maxIterations
      );

      const newTurns = await orchestrator.run(userMessage, context, this.conversationHistory, ragContext);

      this.conversationHistory.push(...newTurns);
      this.pruneHistory();

      this.sm.transition('OBSERVE');
      this.sm.transition('REFLECT');
      this.sm.transition('DONE');
    } catch (err) {
      if ((err as Error).message === 'Request aborted') return;
      const errId = generateId();
      this.bridge.send({
        kind: 'STREAM_ERROR',
        error: (err as Error).message,
        messageId: errId,
      });
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
