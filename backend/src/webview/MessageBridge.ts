import * as vscode from 'vscode';
import { FrontendMessage, BackendMessage, ChatMessage, ConversationSummary } from '@ciper-agent/shared';
import { AgentRunner } from '../agent/AgentRunner';
import { ModelManager } from '../llm/ModelManager';
import { ProviderManager } from '../llm/ProviderManager';
import { WebviewManager } from './WebviewManager';

const CONVERSATIONS_KEY = 'ciper.conversations';
const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES_PER_CONVERSATION = 200;

interface StoredConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  tokenCount: number;
  createdAt: number;
  updatedAt: number;
}

export class MessageBridge {
  private disposable?: vscode.Disposable;
  private _agentRunner: AgentRunner;
  private conversations: Map<string, StoredConversation> = new Map();
  private activeConversationId: string | null = null;

  constructor(
    agentRunner: AgentRunner,
    private modelManager: ModelManager,
    private webviewManager: WebviewManager,
    private storageContext: vscode.ExtensionContext,
    private providerManager?: ProviderManager
  ) {
    this._agentRunner = agentRunner;
    this.loadConversations();
  }

  setAgentRunner(runner: AgentRunner): void {
    this._agentRunner = runner;
  }

  attach(webview: vscode.Webview): void {
    this.disposable?.dispose();
    this.disposable = webview.onDidReceiveMessage(
      (raw: unknown) => this.onMessage(raw as FrontendMessage)
    );
  }

  send(message: BackendMessage): void {
    this.webviewManager.send(message);
  }

  refreshContextSnapshot(): void {
    this.sendContextSnapshot();
  }

  private loadConversations(): void {
    const stored = this.storageContext.workspaceState.get<StoredConversation[]>(CONVERSATIONS_KEY, []);
    for (const conv of stored) {
      this.conversations.set(conv.id, conv);
    }
  }

  private saveConversations(): void {
    const all = Array.from(this.conversations.values());
    const toSave = all.slice(0, MAX_CONVERSATIONS);
    this.storageContext.workspaceState.update(CONVERSATIONS_KEY, toSave);
  }

  private toSummary(conv: StoredConversation): ConversationSummary {
    const firstUser = conv.messages.find(m => m.role === 'user');
    const preview = firstUser ? firstUser.content.slice(0, 60) : '';
    return {
      id: conv.id,
      title: conv.title,
      tokenCount: conv.tokenCount,
      messageCount: conv.messages.length,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      preview,
    };
  }

  private sendConversationsList(): void {
    const summaries = Array.from(this.conversations.values())
      .map(c => this.toSummary(c))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    this.send({ kind: 'RESTORE_CONVERSATIONS', conversations: summaries });
  }

  private async onMessage(msg: FrontendMessage): Promise<void> {
    switch (msg.kind) {
      case 'READY':
        if (this.providerManager) {
          this.providerManager.sendModelsTo(this);
        } else {
          this.modelManager.refreshModels(this);
        }
        this.sendConversationsList();
        this.sendContextSnapshot();
        // If there's an active conversation, load it
        if (this.activeConversationId) {
          const conv = this.conversations.get(this.activeConversationId);
          if (conv) {
            this.send({ kind: 'CONVERSATION_LOADED', conversation: conv });
          }
        }
        break;

      case 'SEND_MESSAGE': {
        // Ensure we have an active conversation
        if (!this.activeConversationId) {
          const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const now = Date.now();
          this.conversations.set(id, {
            id,
            title: 'New conversation',
            messages: [],
            tokenCount: 0,
            createdAt: now,
            updatedAt: now,
          });
          this.activeConversationId = id;
        }

        if (msg.mode === 'agent') {
          await this._agentRunner.runAgent(msg.content, msg.attachedFiles);
        } else {
          await this._agentRunner.runChat(msg.content, msg.attachedFiles);
        }
        break;
      }

      case 'REQUEST_CONTEXT_SNAPSHOT':
        this.sendContextSnapshot();
        break;

      case 'CANCEL_STREAM':
        this._agentRunner.cancel();
        break;

      case 'APPROVE_DIFF':
        this._agentRunner.approveDiff(msg.diffId);
        break;

      case 'REJECT_DIFF':
        this._agentRunner.rejectDiff(msg.diffId);
        break;

      case 'SELECT_MODEL':
        this.modelManager.setSelectedModel(msg.model);
        break;

      case 'SELECT_PROVIDER':
        if (this.providerManager) {
          vscode.workspace.getConfiguration('ciperAgent').update('provider', msg.provider, vscode.ConfigurationTarget.Global);
          this.providerManager.sendModelsTo(this);
        }
        break;

      case 'REQUEST_MODELS':
        await this.modelManager.refreshModels(this);
        break;

      case 'SAVE_HISTORY': {
        if (this.activeConversationId) {
          const conv = this.conversations.get(this.activeConversationId);
          if (conv) {
            const toSave = msg.messages.slice(-MAX_MESSAGES_PER_CONVERSATION);
            const firstUser = toSave.find(m => m.role === 'user');
            const title = firstUser
              ? firstUser.content.slice(0, 40) + (firstUser.content.length > 40 ? '...' : '')
              : 'New conversation';
            conv.messages = toSave;
            conv.title = title;
            conv.updatedAt = Date.now();
            this.saveConversations();
            this.sendConversationsList();
          }
        }
        break;
      }

      case 'CLEAR_HISTORY':
        if (this.activeConversationId) {
          const conv = this.conversations.get(this.activeConversationId);
          if (conv) {
            conv.messages = [];
            conv.title = 'New conversation';
            conv.updatedAt = Date.now();
            this.saveConversations();
            this.sendConversationsList();
          }
        }
        this._agentRunner.clearHistory();
        break;

      case 'NEW_CONVERSATION': {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const now = Date.now();
        this.conversations.set(id, {
          id,
          title: 'New conversation',
          messages: [],
          tokenCount: 0,
          createdAt: now,
          updatedAt: now,
        });
        this.activeConversationId = id;
        this.saveConversations();
        this.sendConversationsList();
        this.send({ kind: 'CONVERSATION_LOADED', conversation: this.conversations.get(id)! });
        this._agentRunner.clearHistory();
        break;
      }

      case 'LOAD_CONVERSATION': {
        const conv = this.conversations.get(msg.conversationId);
        if (conv) {
          this.activeConversationId = msg.conversationId;
          this.send({ kind: 'CONVERSATION_LOADED', conversation: conv });
          this._agentRunner.loadHistory(conv.messages);
        }
        break;
      }

      case 'DELETE_CONVERSATION': {
        this.conversations.delete(msg.conversationId);
        if (this.activeConversationId === msg.conversationId) {
          this.activeConversationId = null;
          this._agentRunner.clearHistory();
        }
        this.saveConversations();
        this.sendConversationsList();
        break;
      }
    }
  }

  private sendContextSnapshot(): void {
    const p = require('path');
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const openFiles = vscode.window.tabGroups.all
      .flatMap(g => g.tabs)
      .map(tab => (tab.input as { uri?: vscode.Uri })?.uri)
      .filter((uri): uri is vscode.Uri => uri?.scheme === 'file')
      .map(uri => p.relative(ws, uri.fsPath))
      .filter((rel: string) => rel && !rel.startsWith('..'));
    const hasSelection = (() => {
      const ed = vscode.window.activeTextEditor;
      return !!ed && !ed.selection.isEmpty;
    })();
    this.send({ kind: 'CONTEXT_SNAPSHOT', openFiles, hasSelection });
  }

  dispose(): void {
    this.disposable?.dispose();
  }
}
