import * as vscode from 'vscode';
import { OllamaClient } from './OllamaClient';
import { MessageBridge } from '../webview/MessageBridge';

export class ModelManager {
  private models: string[] = [];
  private selectedModel: string;

  constructor(
    private ollamaClient: OllamaClient,
    private context: vscode.ExtensionContext
  ) {
    this.selectedModel = vscode.workspace
      .getConfiguration('ciperAgent')
      .get<string>('model', 'qwen2.5-coder:7b');
  }

  async initialize(): Promise<void> {
    const healthy = await this.ollamaClient.checkHealth();
    if (!healthy) {
      vscode.window.showWarningMessage(
        'Ciper Agent: Cannot reach Ollama at ' +
          vscode.workspace
            .getConfiguration('ciperAgent')
            .get('ollamaEndpoint', 'http://localhost:11434') +
          '. Start Ollama and reload.'
      );
      return;
    }

    try {
      this.models = await this.ollamaClient.listModels();
      if (this.models.length > 0 && !this.models.includes(this.selectedModel)) {
        this.selectedModel = this.models[0];
      }
    } catch (err) {
      vscode.window.showErrorMessage(
        `Ciper Agent: Failed to list Ollama models: ${(err as Error).message}`
      );
    }
  }

  getSelectedModel(): string {
    return this.selectedModel;
  }

  getCompletionModel(): string {
    const override = vscode.workspace
      .getConfiguration('ciperAgent')
      .get<string>('completionModel', '');
    return override || this.selectedModel;
  }

  setSelectedModel(model: string): void {
    this.selectedModel = model;
    vscode.workspace
      .getConfiguration('ciperAgent')
      .update('model', model, vscode.ConfigurationTarget.Global);
  }

  getModels(): string[] {
    return this.models;
  }

  sendModelsTo(bridge: MessageBridge): void {
    bridge.send({
      kind: 'MODELS_LIST',
      models: this.models,
      selected: this.selectedModel,
    });
  }

  async refreshModels(bridge?: MessageBridge): Promise<void> {
    try {
      this.models = await this.ollamaClient.listModels();
      if (bridge) {
        this.sendModelsTo(bridge);
      }
    } catch (err) {
      vscode.window.showErrorMessage(
        `Ciper Agent: Failed to refresh models: ${(err as Error).message}`
      );
    }
  }
}
