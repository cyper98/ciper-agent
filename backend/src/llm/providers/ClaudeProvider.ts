import * as https from 'https';
import { LlmProvider, ChatMessage, ModelInfo } from './LlmProvider';

export class ClaudeProvider implements LlmProvider {
  readonly name = 'claude';
  readonly defaultModels = [
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
    'claude-3-sonnet-20240229'
  ];
  
  private apiKey: string;
  private endpoint: string;
  private maxTokens: number;

  constructor() {
    this.apiKey = process.env.ANTHROPIC_API_KEY || '';
    this.endpoint = 'https://api.anthropic.com/v1/messages';
    this.maxTokens = 8192;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const resp = await this.rawRequest({ model: 'claude-3-haiku-20240307', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] });
      return resp.status === 200;
    } catch { return false; }
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!this.apiKey) return [];
    return this.defaultModels.map(id => ({ id: `claude:${id}`, name: id, provider: 'claude' }));
  }

  async *streamChat(model: string, messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<string> {
    const body = {
      model: model.replace('claude:', ''),
      max_tokens: this.maxTokens,
      messages: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
      stream: true
    };

    const resp = await this.streamingRequest(body, signal);
    if (resp.status !== 200) {
      const error = await resp.text();
      throw new Error(`Claude error ${resp.status}: ${error}`);
    }

    const reader = resp.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        if (signal?.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') return;
            try {
              const json = JSON.parse(data);
              if (json.type === 'content_block_delta' && json.delta?.text) yield json.delta.text;
            } catch { /* skip */ }
          }
        }
      }
    } finally { reader.releaseLock(); }
  }

  async chat(model: string, messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
    const body = {
      model: model.replace('claude:', ''),
      max_tokens: this.maxTokens,
      messages: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
    };
    const resp = await this.rawRequest(body, signal);
    if (resp.status !== 200) throw new Error(`Claude error ${resp.status}: ${await resp.text()}`);
    const json = await resp.json() as { content?: Array<{ text?: string }> };
    return json.content?.[0]?.text || '';
  }

  async embed(): Promise<number[]> { return []; }

  private rawRequest(body: object, signal?: AbortSignal): Promise<globalThis.Response> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.endpoint);
      const data = JSON.stringify(body);
      const options: https.RequestOptions = {
        hostname: url.hostname, port: 443, path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01' }
      };

      const chunks: Buffer[] = [];
      const req = https.request(options, res => {
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const response = new globalThis.Response(Buffer.concat(chunks), {
            status: res.statusCode,
            headers: new Headers(res.headers as Record<string, string>)
          });
          resolve(response);
        });
        res.on('error', reject);
      });

      req.on('error', reject);
      signal?.addEventListener('abort', () => { req.destroy(); reject(new Error('aborted')); });
      req.write(data); req.end();
    });
  }

  private streamingRequest(body: object, signal?: AbortSignal): Promise<globalThis.Response> {
    return this.rawRequest(body, signal);
  }
}
