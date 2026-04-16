import * as http from 'http';
import * as https from 'https';
import { StreamParser } from './StreamParser';
import { llmCache } from './LlmCache';
import { LlmProvider, ChatMessage, ModelInfo, LlmProviderConfig } from './providers/LlmProvider';

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

interface OllamaChatChunk {
  model: string;
  created_at: string;
  message: { role: string; content: string };
  done: boolean;
}

interface OllamaTagsResponse {
  models: Array<{ name: string; modified_at: string; size: number }>;
}

export interface LlmCallOptions {
  numCtx?: number;
  numPredict?: number;
  keepAlive?: number | string;
}

export class OllamaClient implements LlmProvider {
  readonly name = 'ollama';
  readonly defaultModels = ['qwen2.5-coder:7b', 'llama3:8b', 'mistral:7b', 'codellama:7b'];
  private baseUrl: string;

  constructor(config: LlmProviderConfig = {}) {
    this.baseUrl = (config.endpoint || 'http://localhost:11434').replace(/\/$/, '');
  }

  async isAvailable(): Promise<boolean> {
    try {
      return await this.checkHealth();
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const models = await this.listRawModels();
    return models.map(m => ({
      id: m,
      name: m,
      provider: 'ollama'
    }));
  }

  async listRawModels(): Promise<string[]> {
    try {
      const data = await this.getRequest('/api/tags');
      const json = JSON.parse(data) as OllamaTagsResponse;
      return json.models.map(m => m.name).sort();
    } catch (err) {
      console.error('Ollama listModels error:', err);
      return [];
    }
  }

  async *streamChat(
    model: string,
    messages: OllamaChatMessage[],
    signal?: AbortSignal,
    _format?: string,
    opts?: LlmCallOptions
  ): AsyncGenerator<string> {
    const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content ?? '';
    const cachedResponse = llmCache.get(lastUserMessage, model);
    
    if (cachedResponse) {
      for (const char of cachedResponse) {
        if (signal?.aborted) return;
        yield char;
      }
      return;
    }

    const body = JSON.stringify({
      model,
      messages: this.convertMessages(messages),
      stream: true,
      keep_alive: -1,
      options: {
        num_predict: -1,
        num_ctx: 8192,
        temperature: 0.1,
      },
    });

    const response = await this.postRequest('/api/chat', body, signal);
    const parser = new StreamParser();

    for await (const chunk of response) {
      const lines = parser.push(chunk.toString('utf-8'));
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line) as OllamaChatChunk;
          if (json.message?.content) {
            yield json.message.content;
          }
          if (json.done) return;
        } catch {
          // Skip malformed JSON lines
        }
      }
    }
  }

  async chat(
    model: string,
    messages: OllamaChatMessage[],
    signal?: AbortSignal
  ): Promise<string> {
    const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content ?? '';
    const cachedResponse = llmCache.get(lastUserMessage, model);
    if (cachedResponse) {
      return cachedResponse;
    }

    let result = '';
    for await (const token of this.streamChat(model, messages, signal)) {
      result += token;
    }
    
    if (result.length >= 10) {
      llmCache.set(lastUserMessage, model, result);
    }
    return result;
  }

  async embed(model: string, text: string, signal?: AbortSignal): Promise<number[]> {
    const body = JSON.stringify({ model, prompt: text });
    try {
      const data = await this.postRequestFull('/api/embeddings', body, signal);
      const json = JSON.parse(data) as { embedding?: number[] };
      return json.embedding ?? [];
    } catch {
      return [];
    }
  }

  async checkHealth(): Promise<boolean> {
    try {
      await this.getRequest('/api/version');
      return true;
    } catch {
      return false;
    }
  }

  private convertMessages(messages: ChatMessage[]): OllamaChatMessage[] {
    return messages.map(m => ({
      role: m.role === 'tool' ? 'assistant' : m.role,
      content: m.content,
    }));
  }

  private getRequest(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + path);
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;

      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        timeout: 10000,
      };

      const req = lib.request(options, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.on('error', reject);
      req.end();
    });
  }

  private postRequest(
    path: string,
    body: string,
    signal?: AbortSignal
  ): Promise<AsyncIterable<Buffer>> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + path);
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;

      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 120000,
      };

      const req = lib.request(options, res => {
        resolve(this.createAsyncIterable(res));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.on('error', reject);
      signal?.addEventListener('abort', () => {
        req.destroy();
        reject(new Error('Request aborted'));
      });

      req.write(body);
      req.end();
    });
  }

  private postRequestFull(
    path: string,
    body: string,
    signal?: AbortSignal
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + path);
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;

      const options: http.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 120000,
      };

      const req = lib.request(options, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.on('error', reject);
      signal?.addEventListener('abort', () => {
        req.destroy();
        reject(new Error('Request aborted'));
      });

      req.write(body);
      req.end();
    });
  }

  private createAsyncIterable(res: http.IncomingMessage): AsyncIterable<Buffer> {
    return {
      [Symbol.asyncIterator]: () => {
        const chunks: Buffer[] = [];
        let resolver: ((chunk: Buffer) => void) | null = null;
        let ended = false;

        res.on('data', chunk => {
          if (resolver) {
            resolver(chunk);
            resolver = null;
          } else {
            chunks.push(chunk);
          }
        });

        res.on('end', () => {
          ended = true;
          resolver?.(Buffer.from([]));
        });

        res.on('error', err => {
          ended = true;
          resolver?.(Buffer.from([]));
        });

        return {
          next: async (): Promise<IteratorResult<Buffer>> => {
            if (chunks.length > 0) {
              return { done: false, value: chunks.shift()! };
            }
            if (ended) {
              return { done: true, value: Buffer.from([]) };
            }
            return new Promise(resolve => {
              resolver = chunk => resolve({ done: false, value: chunk });
            });
          }
        };
      }
    };
  }
}
