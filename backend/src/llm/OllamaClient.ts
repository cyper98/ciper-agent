import * as http from 'http';
import * as https from 'https';
import { StreamParser } from './StreamParser';

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
  /** KV cache slots allocated by Ollama. Match to actual prompt size for speed. Default: 8192 */
  numCtx?: number;
  /** Max output tokens. -1 = unlimited. Cap agent calls to avoid wasted generation. Default: -1 */
  numPredict?: number;
  /**
   * Keep model loaded after request. Use a number (seconds) or duration string ("5m", "1h").
   * -1 (number) = keep forever (Ollama special sentinel). Default: -1.
   * NOTE: must be a number or valid Go duration string — bare string "-1" is NOT valid.
   */
  keepAlive?: number | string;
}

export class OllamaClient {
  private baseUrl: string;

  constructor(baseUrl = 'http://localhost:11434') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  /**
   * Stream a chat completion. Yields individual token strings.
   * Uses Node.js http module directly for proper streaming in the extension host.
   */
  async *streamChat(
    model: string,
    messages: OllamaChatMessage[],
    signal?: AbortSignal,
    format?: 'json',         // when 'json': Ollama uses constrained generation → always valid JSON structure
    opts?: LlmCallOptions
  ): AsyncGenerator<string> {
    const body = JSON.stringify({
      model,
      messages,
      stream: true,
      keep_alive: opts?.keepAlive ?? -1,   // -1 (number) = keep forever; Ollama maps int -1 → MaxInt64
      ...(format ? { format } : {}),
      options: {
        num_predict: opts?.numPredict ?? -1,
        num_ctx: opts?.numCtx ?? 8192,       // sized to actual usage; callers set appropriate value
        temperature: 0.1,                    // deterministic — reduces hallucinated JSON keys
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

  /**
   * Non-streaming chat (used for reflection/checks that need a full response)
   */
  async chat(
    model: string,
    messages: OllamaChatMessage[],
    signal?: AbortSignal
  ): Promise<string> {
    let result = '';
    for await (const token of this.streamChat(model, messages, signal)) {
      result += token;
    }
    return result;
  }

  /**
   * List available models from Ollama
   */
  async listModels(): Promise<string[]> {
    const data = await this.getRequest('/api/tags');
    const json = JSON.parse(data) as OllamaTagsResponse;
    return json.models.map(m => m.name).sort();
  }

  /**
   * Check if Ollama is running and reachable
   */
  async checkHealth(): Promise<boolean> {
    try {
      await this.getRequest('/api/version');
      return true;
    } catch {
      return false;
    }
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
      };

      const req = lib.request(options, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Ollama HTTP ${res.statusCode}: ${res.statusMessage}`));
          return;
        }

        resolve(res as AsyncIterable<Buffer>);
      });

      req.on('error', reject);

      if (signal) {
        signal.addEventListener('abort', () => {
          req.destroy();
          reject(new Error('Request aborted'));
        });
      }

      req.write(body);
      req.end();
    });
  }

  private getRequest(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + path);
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;

      lib.get(url.href, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => resolve(data));
        res.on('error', reject);
      }).on('error', reject);
    });
  }
}
