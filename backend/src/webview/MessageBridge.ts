import * as vscode from 'vscode';
import { FrontendMessage, BackendMessage, ChatMessage } from '@ciper-agent/shared';
import { AgentRunner } from '../agent/AgentRunner';
import { ModelManager } from '../llm/ModelManager';
import { WebviewManager } from './WebviewManager';

const HISTORY_KEY = 'ciper.chatHistory';
const MAX_STORED_MESSAGES = 200; // cap to avoid ballooning workspace state

export class MessageBridge {
  private disposable?: vscode.Disposable;
  private _agentRunner: AgentRunner;

  constructor(
    agentRunner: AgentRunner,
    private modelManager: ModelManager,
    private webviewManager: WebviewManager,
    private storageContext: vscode.ExtensionContext
  ) {
    this._agentRunner = agentRunner;
  }

  setAgentRunner(runner: AgentRunner): void {
    this._agentRunner = runner;
  }

  /**
   * Attach to a webview and start listening for messages.
   */
  attach(webview: vscode.Webview): void {
    this.disposable?.dispose();
    this.disposable = webview.onDidReceiveMessage(
      (raw: unknown) => this.onMessage(raw as FrontendMessage)
    );
  }

  /**
   * Send a typed message to the webview.
   */
  send(message: BackendMessage): void {
    this.webviewManager.send(message);
  }

  private async onMessage(msg: FrontendMessage): Promise<void> {
    switch (msg.kind) {
      case 'READY':
        // Fetch latest models then deliver initial state.
        this.modelManager.refreshModels(this).then(() => {
          this.restoreHistory();
          this.sendContextSnapshot();
        });
        break;

      case 'SEND_MESSAGE':
        if (msg.mode === 'agent') {
          await this._agentRunner.runAgent(msg.content, msg.attachedFiles);
        } else {
          await this._agentRunner.runChat(msg.content, msg.attachedFiles);
        }
        break;

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

      case 'REQUEST_MODELS':
        await this.modelManager.refreshModels(this);
        break;

      case 'SAVE_HISTORY': {
        // Keep only the last MAX_STORED_MESSAGES to cap storage size
        const toSave = msg.messages.slice(-MAX_STORED_MESSAGES);
        await this.storageContext.workspaceState.update(HISTORY_KEY, toSave);
        break;
      }

      case 'CLEAR_HISTORY':
        await this.storageContext.workspaceState.update(HISTORY_KEY, []);
        this._agentRunner.clearHistory();
        break;
    }
  }

  private restoreHistory(): void {
    const saved = this.storageContext.workspaceState.get<ChatMessage[]>(HISTORY_KEY, []);
    if (saved.length > 0) {
      this.send({ kind: 'RESTORE_HISTORY', messages: saved });
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
