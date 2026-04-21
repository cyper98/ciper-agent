import * as vscode from 'vscode';
import { LlmProvider } from './providers/LlmProvider';
import { MessageBridge } from '../webview/MessageBridge';

export class ModelManager {
  private models: string[] = [];
  private selectedModel: string;

  constructor(
    private provider: LlmProvider,
    private context: vscode.ExtensionContext
  ) {
    this.selectedModel = vscode.workspace
      .getConfiguration('ciperAgent')
      .get<string>('model', 'qwen2.5-coder:7b');
  }

  async initialize(): Promise<void> {
    let healthy = await this.provider.isAvailable();
    const maxRetries = 3;
    const baseDelay = 500;

    for (let attempt = 0; !healthy && attempt < maxRetries; attempt++) {
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
      healthy = await this.provider.isAvailable();
    }

    if (!healthy) {
      setTimeout(() => {
        vscode.window.showWarningMessage(
          'Ciper Agent: LLM provider not available. Check settings.'
        );
      }, 100);
      return;
    }

    try {
      const modelInfos = await this.provider.listModels();
      this.models = modelInfos.map(m => m.name);
      if (this.models.length > 0 && !this.models.includes(this.selectedModel)) {
        this.selectedModel = this.models[0];
      }
    } catch (err) {
      vscode.window.showErrorMessage(
        `Ciper Agent: Failed to list models: ${(err as Error).message}`
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
      const modelInfos = await this.provider.listModels();
      this.models = modelInfos.map(m => m.name);
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
