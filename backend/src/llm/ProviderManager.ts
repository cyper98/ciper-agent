import * as vscode from 'vscode';
import { OllamaClient } from './OllamaClient';
import { ClaudeProvider } from './providers/ClaudeProvider';
import { OpenAIProvider } from './providers/OpenAIProvider';
import { LlmProvider, ModelInfo } from './providers/LlmProvider';
import { MessageBridge } from '../webview/MessageBridge';

export type LlmProviderType = 'ollama' | 'anthropic' | 'openai';

export class ProviderManager {
  private currentProvider: LlmProviderType = 'ollama';
  private ollamaClient: OllamaClient;
  private claudeProvider: ClaudeProvider;
  private openaiProvider: OpenAIProvider;

  constructor() {
    this.ollamaClient = new OllamaClient({ endpoint: 'http://localhost:11434' });
    this.claudeProvider = new ClaudeProvider();
    this.openaiProvider = new OpenAIProvider();
  }

  getProviderType(): LlmProviderType {
    return vscode.workspace.getConfiguration('ciperAgent').get<string>('provider', 'ollama') as LlmProviderType;
  }

  getCurrentProvider(): LlmProvider {
    this.currentProvider = this.getProviderType();
    switch (this.currentProvider) {
      case 'anthropic':
        return this.claudeProvider;
      case 'openai':
        return this.openaiProvider;
      case 'ollama':
      default:
        return this.ollamaClient;
    }
  }

  async initialize(): Promise<void> {
    const providerType = this.getProviderType();
    const provider = this.getCurrentProvider();

    let available = await provider.isAvailable();
    const maxRetries = 3;
    const baseDelay = 500;

    for (let attempt = 0; !available && attempt < maxRetries; attempt++) {
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
      available = await provider.isAvailable();
    }

    if (!available) {
      setTimeout(() => {
        vscode.window.showWarningMessage(
          `Ciper Agent: ${this.getProviderName(providerType)} is not available. Check settings.`
        );
      }, 100);
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const provider = this.getCurrentProvider();
    return provider.listModels();
  }

  async refreshModels(): Promise<ModelInfo[]> {
    const provider = this.getCurrentProvider();
    if (!(await provider.isAvailable())) {
      return [];
    }
    return provider.listModels();
  }

  async sendModelsTo(bridge: MessageBridge): Promise<void> {
    const providerType = this.getProviderType();
    const provider = this.getCurrentProvider();

    const maxRetries = 3;
    const baseDelay = 500;
    let models: ModelInfo[] = [];

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      if (!(await provider.isAvailable())) {
        continue;
      }

      models = await provider.listModels();
      if (models.length > 0) break;
    }

    if (models.length === 0) {
      models = await provider.listModels().catch(() => []);
    }

    const modelNames = models.map(m => m.name);
    bridge.send({
      kind: 'MODELS_LIST',
      models: modelNames,
      selected: modelNames[0] || '',
      provider: providerType
    });
  }

  private getProviderName(type: LlmProviderType): string {
    switch (type) {
      case 'anthropic': return 'Anthropic Claude';
      case 'openai': return 'OpenAI';
      case 'ollama': return 'Ollama';
    }
  }
}
