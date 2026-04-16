/**
 * LLM Provider Interface
 * Abstract interface for different LLM backends (Ollama, Claude, OpenAI/Codex)
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface LlmProviderConfig {
  apiKey?: string;
  endpoint?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LlmCallOptions {
  numCtx?: number;
  numPredict?: number;
  keepAlive?: number | string;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
}

export interface LlmProvider {
  readonly name: string;
  readonly defaultModels: string[];
  
  /**
   * Check if the provider is configured and accessible
   */
  isAvailable(): Promise<boolean>;
  
  /**
   * List available models for this provider
   */
  listModels(): Promise<ModelInfo[]>;
  
  /**
   * Stream chat completion
   */
  streamChat(
    model: string,
    messages: ChatMessage[],
    signal?: AbortSignal,
    _format?: string,
    _opts?: LlmCallOptions
  ): AsyncGenerator<string>;
  
  /**
   * Non-streaming chat completion
   */
  chat(model: string, messages: ChatMessage[], signal?: AbortSignal): Promise<string>;
  
  /**
   * Generate embeddings (for RAG)
   */
  embed(model: string, text: string, signal?: AbortSignal): Promise<number[]>;
}
