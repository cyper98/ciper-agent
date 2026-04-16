/**
 * LLM Response Cache with semantic hashing.
 * Caches repeated/similar queries to reduce LLM calls and improve response time.
 */

import * as crypto from 'crypto';

export interface CacheEntry {
  response: string;
  model: string;
  timestamp: number;
  hitCount: number;
}

interface NormalizedQuery {
  hash: string;
  normalized: string;
  toolsMentioned: string[];
}

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 100;

export class LlmCache {
  private cache = new Map<string, CacheEntry>();
  private maxEntries: number;
  private ttlMs: number;

  constructor(maxEntries = DEFAULT_MAX_ENTRIES, ttlMs = DEFAULT_TTL_MS) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
  }

  /**
   * Normalize a query for better cache hit rate.
   * Removes variable parts like file paths, line numbers, timestamps.
   */
  normalizeQuery(query: string): NormalizedQuery {
    const normalized = query
      .replace(/['"`]?\/[^\s'"]+['"`]/g, '"PATH"')
      .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/g, 'TIMESTAMP')
      .replace(/\d+ lines?/gi, 'N lines')
      .replace(/\bline \d+/gi, 'line N')
      .replace(/\btask[-_]?\d+/gi, 'task_N')
      .replace(/[a-f0-9]{8,}/gi, 'HASH')
      .replace(/\s+/g, ' ')
      .trim();

    const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);

    const toolsMentioned: string[] = [];
    const toolPatterns = [
      'read_file', 'write_file', 'edit_file', 'list_files',
      'search_code', 'run_command', 'sub_tasks', 'done'
    ];
    for (const tool of toolPatterns) {
      if (normalized.includes(tool)) {
        toolsMentioned.push(tool);
      }
    }

    return { hash, normalized, toolsMentioned };
  }

  /**
   * Get cached response for a query.
   * Returns null if not found or expired.
   */
  get(query: string, model: string): string | null {
    const { hash } = this.normalizeQuery(query);
    const key = this.makeKey(hash, model);
    const entry = this.cache.get(key);

    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    entry.hitCount++;
    return entry.response;
  }

  /**
   * Store a response in the cache.
   */
  set(query: string, model: string, response: string): void {
    if (response.length < 10) return;

    const { hash } = this.normalizeQuery(query);
    const key = this.makeKey(hash, model);

    this.cache.set(key, {
      response,
      model,
      timestamp: Date.now(),
      hitCount: 0,
    });

    this.evictIfNeeded();
  }

  /**
   * Check if a query would hit the cache (without counting as a hit).
   */
  has(query: string, model: string): boolean {
    const { hash } = this.normalizeQuery(query);
    const key = this.makeKey(hash, model);
    const entry = this.cache.get(key);

    if (!entry) return false;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Invalidate entries matching a pattern.
   */
  invalidate(pattern?: string): void {
    if (!pattern) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get cache statistics.
   */
  stats(): { size: number; avgHitCount: number; oldestEntry: number } {
    const entries = Array.from(this.cache.values());
    const hitCounts = entries.map(e => e.hitCount);
    const avgHitCount = hitCounts.length > 0
      ? hitCounts.reduce((a, b) => a + b, 0) / hitCounts.length
      : 0;
    const oldestEntry = entries.length > 0
      ? Math.min(...entries.map(e => e.timestamp))
      : 0;

    return {
      size: this.cache.size,
      avgHitCount,
      oldestEntry,
    };
  }

  private makeKey(hash: string, model: string): string {
    return `${model}:${hash}`;
  }

  private evictIfNeeded(): void {
    if (this.cache.size <= this.maxEntries) return;

    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => {
      const ageA = Date.now() - a[1].timestamp;
      const ageB = Date.now() - b[1].timestamp;
      const scoreA = ageA * (1 + a[1].hitCount * 0.1);
      const scoreB = ageB * (1 + b[1].hitCount * 0.1);
      return scoreB - scoreA;
    });

    const toRemove = entries.slice(this.maxEntries);
    for (const [key] of toRemove) {
      this.cache.delete(key);
    }
  }
}

export const llmCache = new LlmCache();
