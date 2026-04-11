/**
 * Estimates token counts and enforces a token budget for context building.
 * Uses a 4 characters per token heuristic (conservative for code).
 */

const CHARS_PER_TOKEN = 4;

export interface ScoredContent {
  content: string;
  label: string;
  priority: number; // Higher = more important
}

export class TokenBudget {
  private budget: number;

  constructor(budget = 8192) {
    this.budget = budget;
  }

  estimate(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  getBudget(): number {
    return this.budget;
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
   * Truncate text to fit within a given token count.
   */
  truncate(text: string, maxTokens: number): string {
    const maxChars = maxTokens * CHARS_PER_TOKEN;
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars) + '\n... (truncated)';
  }

  /**
   * Total tokens used by a list of content items.
   */
  totalTokens(items: ScoredContent[]): number {
    return items.reduce((sum, item) => sum + this.estimate(item.content), 0);
  }
}
