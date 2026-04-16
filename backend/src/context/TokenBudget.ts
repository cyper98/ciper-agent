/**
 * Token budget management with semantic-aware truncation.
 * Uses SemanticChunker for intelligent boundary detection.
 */

import { SemanticChunker } from './SemanticChunker';

const CHARS_PER_TOKEN = 4;

export interface ScoredContent {
  content: string;
  label: string;
  priority: number;
}

export interface TruncationResult {
  content: string;
  truncated: boolean;
  originalLines: number;
  keptLines: number;
}

export class TokenBudget {
  private budget: number;
  private chunker: SemanticChunker;

  constructor(budget = 8192) {
    this.budget = budget;
    this.chunker = new SemanticChunker();
  }

  estimate(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  getBudget(): number {
    return this.budget;
  }

  setBudget(budget: number): void {
    this.budget = budget;
  }

  /**
   * Fit as many content items as possible within the token budget.
   * Items are sorted by priority (highest first) and included greedily.
   */
  fitContent(items: ScoredContent[]): ScoredContent[] {
    const sorted = [...items].sort((a, b) => b.priority - a.priority);
    const result: ScoredContent[] = [];
    let used = 0;

    for (const item of sorted) {
      const tokens = this.estimate(item.content);
      if (used + tokens <= this.budget) {
        result.push(item);
        used += tokens;
      }
    }

    return result;
  }

  /**
   * Truncate text using semantic chunking to preserve meaningful boundaries.
   * Returns both truncated content and metadata.
   */
  truncate(text: string, maxTokens: number): TruncationResult {
    const maxChars = maxTokens * CHARS_PER_TOKEN;
    const originalLines = text.split('\n').length;

    if (text.length <= maxChars) {
      return {
        content: text,
        truncated: false,
        originalLines,
        keptLines: originalLines,
      };
    }

    const { text: truncated, truncated: wasTruncated } = this.chunker.truncateWithSemantics(
      text,
      maxTokens,
      CHARS_PER_TOKEN
    );

    const keptLines = truncated.split('\n').length;

    return {
      content: truncated,
      truncated: wasTruncated,
      originalLines,
      keptLines,
    };
  }

  /**
   * Legacy truncate method for backward compatibility.
   */
  truncateLegacy(text: string, maxTokens: number): string {
    const result = this.truncate(text, maxTokens);
    return result.content;
  }

  /**
   * Truncate with query relevance scoring.
   * Prioritizes chunks relevant to the query.
   */
  truncateWithQuery(text: string, maxTokens: number, query: string): string {
    if (text.length <= maxTokens * CHARS_PER_TOKEN) {
      return text;
    }
    return this.chunker.extractRelevantChunks(text, query, maxTokens, CHARS_PER_TOKEN);
  }

  /**
   * Total tokens used by a list of content items.
   */
  totalTokens(items: ScoredContent[]): number {
    return items.reduce((sum, item) => sum + this.estimate(item.content), 0);
  }

  /**
   * Calculate remaining budget after items.
   */
  remainingBudget(items: ScoredContent[]): number {
    const used = this.totalTokens(items);
    return Math.max(0, this.budget - used);
  }

  /**
   * Get usage stats.
   */
  getUsageStats(items: ScoredContent[]): {
    used: number;
    total: number;
    percentUsed: number;
  } {
    const used = this.totalTokens(items);
    return {
      used,
      total: this.budget,
      percentUsed: Math.round((used / this.budget) * 100),
    };
  }
}
