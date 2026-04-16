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

    const available = await provider.isAvailable();
    if (!available) {
      vscode.window.showWarningMessage(
        `Ciper Agent: ${this.getProviderName(providerType)} is not available. Check settings.`
      );
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

  sendModelsTo(bridge: MessageBridge): void {
    const providerType = this.getProviderType();
    const provider = this.getCurrentProvider();

    provider.listModels().then(models => {
      const modelNames = models.map(m => m.name);
      bridge.send({
        kind: 'MODELS_LIST',
        models: modelNames,
        selected: modelNames[0] || '',
        provider: providerType
      });
    }).catch(err => {
      console.error('Failed to list models:', err);
      bridge.send({
        kind: 'MODELS_LIST',
        models: [],
        selected: '',
        provider: providerType
      });
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
