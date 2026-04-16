import * as vscode from 'vscode';
import { LlmProvider } from '../llm/providers/LlmProvider';
import { WorkspaceIndexer } from './workspace-indexer';

export interface RetrievedChunk {
  filePath: string;
  startLine: number;
  text: string;
  score: number;
}

/**
 * Semantic context retrieval using cosine similarity over embedded workspace chunks.
 * Retrieves the top-K most relevant code chunks for a given query.
 *
 * Requires:
 *   - ciperAgent.ragEnabled: true
 *   - ciperAgent.embeddingModel pulled in Ollama (e.g. `ollama pull nomic-embed-text`)
 */
export class SemanticRetriever {
  constructor(
    private llmProvider: LlmProvider,
    private indexer: WorkspaceIndexer
  ) {}

  /**
   * Retrieve the top-K chunks most relevant to the query.
   * Returns an empty array if RAG is disabled or the index is empty.
   */
  async retrieve(query: string, signal?: AbortSignal): Promise<RetrievedChunk[]> {
    const cfg = vscode.workspace.getConfiguration('ciperAgent');
    if (!cfg.get<boolean>('ragEnabled', false)) return [];
    if (!this.indexer.isIndexed) return [];

    const chunks = this.indexer.getChunks();
    if (chunks.length === 0) return [];

    const model = cfg.get<string>('embeddingModel', 'nomic-embed-text').trim();
    const topK = cfg.get<number>('ragTopK', 10);

    const queryVec = await this.llmProvider.embed(model, query, signal);
    if (queryVec.length === 0) {
      console.warn(
        `Ciper Agent: RAG embed returned empty vector for model "${model}". ` +
        `Run: ollama pull ${model}`
      );
      return [];
    }

    const scored = chunks
      .map(c => ({
        filePath: c.filePath,
        startLine: c.startLine,
        text: c.text,
        score: cosineSimilarity(queryVec, c.vector),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored;
  }

  /**
   * Format retrieved chunks as a context section for the orchestrator system prompt.
   * Returns an empty string if no chunks were retrieved.
   */
  formatAsContext(chunks: RetrievedChunk[]): string {
    if (chunks.length === 0) return '';
    const parts = chunks.map(c =>
      `### ${c.filePath} (line ${c.startLine + 1})\n${c.text}`
    );
    return `\n### Semantically Relevant Code (RAG):\n${parts.join('\n\n')}`;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
