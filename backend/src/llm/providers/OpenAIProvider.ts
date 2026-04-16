import * as https from 'https';
import { LlmProvider, ChatMessage, ModelInfo } from './LlmProvider';

export class OpenAIProvider implements LlmProvider {
  readonly name = 'openai';
  readonly defaultModels = [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-3.5-turbo',
    'o1-preview',
    'o1-mini'
  ];

  private apiKey: string;
  private endpoint: string;
  private maxTokens: number;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || '';
    this.endpoint = 'https://api.openai.com/v1/chat/completions';
    this.maxTokens = 4096;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const resp = await this.request({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 });
      return resp.status === 200;
    } catch { return false; }
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!this.apiKey) return [];
    return this.defaultModels.map(id => ({ id: `openai:${id}`, name: id, provider: 'openai' }));
  }

  async *streamChat(model: string, messages: ChatMessage[], signal?: AbortSignal): AsyncGenerator<string> {
    const body = {
      model: model.replace('openai:', ''),
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      stream: true
    };

    const resp = await this.streamingRequest(body, signal);
    if (resp.status !== 200) throw new Error(`OpenAI error ${resp.status}: ${await resp.text()}`);

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
              if (json.choices?.[0]?.delta?.content) yield json.choices[0].delta.content;
            } catch { /* skip */ }
          }
        }
      }
    } finally { reader.releaseLock(); }
  }

  async chat(model: string, messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
    const body = {
      model: model.replace('openai:', ''),
      messages: messages.map(m => ({ role: m.role, content: m.content }))
    };
    const resp = await this.request(body, signal);
    if (resp.status !== 200) throw new Error(`OpenAI error ${resp.status}: ${await resp.text()}`);
    const json = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content || '';
  }

  async embed(model: string, text: string, signal?: AbortSignal): Promise<number[]> {
    const body = { model: model.replace('openai:', ''), input: text };
    try {
      const resp = await this.embedRequest(body, signal);
      if (resp.status !== 200) return [];
      const json = await resp.json() as { data?: Array<{ embedding?: number[] }> };
      return json.data?.[0]?.embedding || [];
    } catch { return []; }
  }

  private request(body: object, signal?: AbortSignal): Promise<globalThis.Response> {
    return this.doRequest(body, false, signal);
  }

  private streamingRequest(body: object, signal?: AbortSignal): Promise<globalThis.Response> {
    return this.doRequest(body, true, signal);
  }

  private embedRequest(body: object, signal?: AbortSignal): Promise<globalThis.Response> {
    return new Promise((resolve, reject) => {
      const url = new URL('https://api.openai.com/v1/embeddings');
      const data = JSON.stringify(body);
      const options: https.RequestOptions = {
        hostname: url.hostname, port: 443, path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'Authorization': `Bearer ${this.apiKey}` }
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

  private doRequest(body: object, _stream: boolean, signal?: AbortSignal): Promise<globalThis.Response> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.endpoint);
      const data = JSON.stringify({ ...body, max_tokens: this.maxTokens });
      const options: https.RequestOptions = {
        hostname: url.hostname, port: 443, path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'Authorization': `Bearer ${this.apiKey}` }
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
}
