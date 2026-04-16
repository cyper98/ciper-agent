/**
 * Semantic chunker - splits text at meaningful boundaries instead of arbitrary cuts.
 * Improves context quality by preserving function/class/paragraph coherence.
 */

export interface Chunk {
  text: string;
  startLine: number;
  endLine: number;
}

const CODE_BLOCK_PATTERNS = [
  /^(export |async |function |const |let |var |class |interface |type |def |fn |pub fn |impl )/m,
  /^(import |require |from )/m,
  /^(if |else |for |while |switch |case |try |catch |finally )[\s(]/m,
  /^(return |break |continue |throw )/m,
  /^{[\s\n]*$/m,
  /^}[\s\n]*$/m,
];

const PARAGRAPH_BREAKS = /\n\n+/;
const MAX_CHUNK_LINES = 150;
const MIN_CHUNK_LINES = 20;

export class SemanticChunker {
  /**
   * Split text into semantically coherent chunks at function/class/paragraph boundaries.
   */
  chunkBySemantics(text: string, maxLines = MAX_CHUNK_LINES): Chunk[] {
    const lines = text.split('\n');
    if (lines.length <= maxLines) {
      return [{ text, startLine: 1, endLine: lines.length }];
    }

    const chunks: Chunk[] = [];
    let currentStart = 0;
    let currentLines: string[] = [];
    let inBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      currentLines.push(line);

      const isBlockStart = this.isBlockStart(line);
      const isBlockEnd = this.isBlockEnd(line);
      const exceedsMax = currentLines.length >= maxLines;
      const hasParagraphBreak = PARAGRAPH_BREAKS.test(line);

      if (exceedsMax && (isBlockEnd || hasParagraphBreak || isBlockStart)) {
        chunks.push({
          text: currentLines.join('\n'),
          startLine: currentStart + 1,
          endLine: i + 1,
        });
        currentStart = i + 1;
        currentLines = [];
        inBlock = isBlockStart;
      } else if (exceedsMax && !inBlock) {
        const midPoint = Math.floor(currentLines.length / 2);
        const firstHalf = currentLines.slice(0, midPoint);
        const secondHalf = currentLines.slice(midPoint);
        
        chunks.push({
          text: firstHalf.join('\n'),
          startLine: currentStart + 1,
          endLine: currentStart + firstHalf.length,
        });
        
        currentStart = currentStart + firstHalf.length;
        currentLines = secondHalf;
        inBlock = false;
      } else {
        inBlock = isBlockStart || (!isBlockEnd && inBlock);
      }
    }

    if (currentLines.length >= MIN_CHUNK_LINES) {
      chunks.push({
        text: currentLines.join('\n'),
        startLine: currentStart + 1,
        endLine: lines.length,
      });
    } else if (chunks.length > 0) {
      chunks[chunks.length - 1].text += '\n' + currentLines.join('\n');
      chunks[chunks.length - 1].endLine = lines.length;
    }

    return chunks;
  }

  private isBlockStart(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*')) {
      return false;
    }
    return CODE_BLOCK_PATTERNS.some(p => p.test(trimmed));
  }

  private isBlockEnd(line: string): boolean {
    const trimmed = line.trim();
    if (trimmed === '}' || trimmed === ']);' || trimmed === '});' || trimmed === ');') {
      return true;
    }
    if (/^\}[,\s]*$/.test(trimmed) && trimmed.length < 10) {
      return true;
    }
    return false;
  }

  /**
   * Truncate text to max tokens while preserving semantic boundaries.
   * Returns [truncatedContent, wasTruncated]
   */
  truncateWithSemantics(
    text: string,
    maxTokens: number,
    charsPerToken = 4
  ): { text: string; truncated: boolean } {
    const maxChars = maxTokens * charsPerToken;
    if (text.length <= maxChars) {
      return { text, truncated: false };
    }

    const chunks = this.chunkBySemantics(text, Math.ceil(maxChars / 80));
    let result = '';
    let resultTokens = 0;

    for (const chunk of chunks) {
      const chunkTokens = Math.ceil(chunk.text.length / charsPerToken);
      if (resultTokens + chunkTokens <= maxTokens) {
        result += (result ? '\n\n' : '') + chunk.text;
        resultTokens += chunkTokens;
      } else {
        const remaining = maxTokens - resultTokens;
        if (remaining >= 10) {
          const remainingChars = remaining * charsPerToken;
          result += (result ? '\n\n' : '') + chunk.text.slice(0, remainingChars);
        }
        break;
      }
    }

    const linesIncluded = result.split('\n').length;
    const totalLines = text.split('\n').length;
    const truncationNote = linesIncluded < totalLines 
      ? `\n\n/* ... truncated ${totalLines - linesIncluded} lines (semantic boundary preserved) */`
      : '';

    return { text: result + truncationNote, truncated: linesIncluded < totalLines };
  }

  /**
   * Extract relevant chunks based on a query.
   * Useful for RAG scenarios where we need to find relevant sections.
   */
  extractRelevantChunks(
    text: string,
    query: string,
    maxTokens: number,
    charsPerToken = 4
  ): string {
    const chunks = this.chunkBySemantics(text);
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

    const scored = chunks.map((chunk, idx) => {
      const contentLower = chunk.text.toLowerCase();
      let score = 0;
      for (const word of queryWords) {
        const matches = (contentLower.match(new RegExp(word, 'g')) || []).length;
        score += matches;
      }
      if (chunk.startLine <= 5) score += 2;
      if (contentLower.includes('function ') || contentLower.includes('class ')) score += 1;
      return { chunk, score, idx };
    });

    scored.sort((a, b) => b.score - a.score);

    let result = '';
    let usedTokens = 0;
    const maxChars = maxTokens * charsPerToken;

    for (const item of scored) {
      if (usedTokens + item.chunk.text.length > maxChars) {
        const remaining = maxChars - usedTokens;
        if (remaining > 100) {
          result += (result ? '\n\n' : '') + item.chunk.text.slice(0, remaining);
        }
        break;
      }
      result += (result ? '\n\n' : '') + item.chunk.text;
      usedTokens += item.chunk.text.length + 2;
    }

    return result || text.slice(0, maxChars);
  }
}
