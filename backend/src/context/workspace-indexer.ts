import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { LlmProvider } from '../llm/providers/LlmProvider';

export interface IndexedChunk {
  filePath: string;   // relative path from workspace root
  startLine: number;
  text: string;       // chunk text prefixed with file path comment
  vector: number[];
}

// ~800 characters per chunk (~200 tokens at 4 chars/token)
const CHUNK_CHARS    = 800;
const OVERLAP_CHARS  = 200;
const MAX_FILES      = 500;

const INDEXABLE_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.cs', '.cpp', '.c', '.h',
  '.md', '.json', '.yaml', '.yml', '.toml',
]);

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'out',
  '__pycache__', '.venv', 'venv', 'coverage', '.turbo',
]);

/**
 * Indexes workspace files into an in-memory vector store for RAG retrieval.
 * Embedding model is configured via ciperAgent.embeddingModel (default: nomic-embed-text).
 * Works on CPU — embedding models are small and don't require a GPU.
 */
export class WorkspaceIndexer {
  private chunks: IndexedChunk[] = [];
  private _isIndexed = false;

  constructor(
    private llmProvider: LlmProvider,
    private workspaceRoot: string
  ) {}

  get isIndexed(): boolean { return this._isIndexed; }
  getChunks(): IndexedChunk[] { return this.chunks; }

  /** Build the full index. Called once on activation when ragEnabled is true. */
  async buildIndex(): Promise<void> {
    const model = this.getEmbeddingModel();
    if (!model) return;

    const files = await this.collectFiles();
    this.chunks = [];

    for (const absPath of files) {
      await this.indexFile(absPath, model);
    }

    this._isIndexed = true;
  }

  /** Re-index a single file after it changes (called by file watcher). */
  async reindexFile(absPath: string): Promise<void> {
    const relPath = path.relative(this.workspaceRoot, absPath);
    this.chunks = this.chunks.filter(c => c.filePath !== relPath);
    // Guard against unbounded growth from workspaces that create many files over time
    if (this.chunks.length > MAX_FILES * 15) return;
    const model = this.getEmbeddingModel();
    if (!model) return;
    await this.indexFile(absPath, model);
  }

  private async indexFile(absPath: string, model: string): Promise<void> {
    const relPath = path.relative(this.workspaceRoot, absPath);
    try {
      const content = await fs.readFile(absPath, 'utf-8');
      const rawChunks = chunkText(content, relPath);
      for (const chunk of rawChunks) {
        const vector = await this.llmProvider.embed(model, chunk.text);
        if (vector.length > 0) {
          this.chunks.push({ ...chunk, vector });
        }
      }
    } catch {
      // Skip unreadable or binary files
    }
  }

  private getEmbeddingModel(): string {
    return vscode.workspace
      .getConfiguration('ciperAgent')
      .get<string>('embeddingModel', 'nomic-embed-text')
      .trim();
  }

  private async collectFiles(): Promise<string[]> {
    const results: string[] = [];

    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (INDEXABLE_EXT.has(path.extname(entry.name).toLowerCase())) {
          results.push(full);
          if (results.length >= MAX_FILES) return;
        }
      }
    };

    await walk(this.workspaceRoot);
    return results;
  }
}

/** Split file content into overlapping chunks for embedding. */
function chunkText(
  content: string,
  relPath: string
): Omit<IndexedChunk, 'vector'>[] {
  const chunks: Omit<IndexedChunk, 'vector'>[] = [];
  let charPos = 0;
  let lineIndex = 0;

  while (charPos < content.length) {
    const end = Math.min(charPos + CHUNK_CHARS, content.length);
    const slice = content.slice(charPos, end);

    // Count lines consumed by this chunk to track startLine accurately
    const linesInChunk = slice.split('\n').length - 1;
    const startLine = lineIndex;

    chunks.push({
      filePath: relPath,
      startLine,
      // Prefix with file path so the model knows the source when retrieving
      text: `// ${relPath} (line ${startLine + 1})\n${slice}`,
    });

    lineIndex += linesInChunk;
    const nextPos = end - OVERLAP_CHARS;
    if (nextPos <= charPos || end === content.length) break;
    charPos = nextPos;
  }

  return chunks;
}
