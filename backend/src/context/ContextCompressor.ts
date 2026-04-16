/**
 * Context Compressor - Summarizes code files to fit within token budget
 * while preserving semantic meaning and structure.
 * 
 * Instead of truncation (which breaks SQL queries, function bodies, etc.),
 * this compresses files by:
 * 1. Extracting structural elements (structs, functions, interfaces)
 * 2. Preserving important content (SQL queries, constants, comments)
 * 3. Summarizing repetitive boilerplate
 */

import { LlmProvider, ChatMessage } from '../llm/providers/LlmProvider';

const CHARS_PER_TOKEN = 4;

export interface CompressionResult {
  original: string;
  compressed: string;
  compressionRatio: number;
  method: 'full' | 'summarized' | 'partial';
}

export interface CompressOptions {
  maxTokens: number;
  language: string;
  filePath: string;
  query?: string;
  preservePatterns?: string[];
}

export class ContextCompressor {
  constructor(private llmProvider: LlmProvider, private model: string) {}

  /**
   * Compress a file to fit within maxTokens.
   * Uses LLM summarization for large files, preserves structure for important content.
   */
  async compress(
    content: string,
    options: CompressOptions
  ): Promise<CompressionResult> {
    const { maxTokens, language, filePath, query } = options;
    const currentTokens = Math.ceil(content.length / CHARS_PER_TOKEN);
    
    // If already within budget, return as-is
    if (currentTokens <= maxTokens) {
      return {
        original: content,
        compressed: content,
        compressionRatio: 1,
        method: 'full',
      };
    }

    // Check if content has patterns that should be preserved (SQL, long queries, etc.)
    const hasSqlPattern = /(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\s+.+\s+(FROM|WHERE|JOIN|ON|GROUP BY|ORDER BY)/i;
    const hasSql = hasSqlPattern.test(content);
    const hasLongStrings = content.split('\n').some(line => line.length > 300);
    const hasComplexStructs = /type\s+\w+\s+struct\s*\{[\s\S]{200,}\}/.test(content);

    // For Go files with SQL, use specialized summarization
    if (language === 'go' || language === 'golang') {
      const summarized = await this.summarizeGoFile(content, filePath, query, maxTokens);
      return summarized;
    }

    // For other languages, use general summarization
    const summarized = await this.summarizeGeneric(content, filePath, language, query, maxTokens);
    return summarized;
  }

  /**
   * Specialized Go file summarization that preserves:
   * - SQL queries (raw strings)
   * - Struct definitions
   * - Function signatures with comments
   * - Constants and types
   */
  private async summarizeGoFile(
    content: string,
    filePath: string,
    query: string | undefined,
    maxTokens: number
  ): Promise<CompressionResult> {
    const targetChars = maxTokens * CHARS_PER_TOKEN * 0.85; // Leave 15% buffer

    // Extract and preserve SQL queries first
    const sqlBlocks: string[] = [];
    const sqlRegex = /`([^`]+)`/g;
    const sqlKeywords = ['SELECT', 'FROM', 'WHERE', 'JOIN', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER'];
    let match;
    while ((match = sqlRegex.exec(content)) !== null) {
      const block = match[1];
      const hasSql = sqlKeywords.some(kw => block.toUpperCase().includes(kw));
      if (hasSql && block.length > 50) {
        sqlBlocks.push(block.trim());
      }
    }

    // Extract function signatures and their docs
    const functionBlocks: string[] = [];
    const funcRegex = /func\s+(\([^)]+\))?\s*(\w+)\s*(\([^)]*\))\s*(.*?)(?={|$)/gs;
    const funcMatches = [...content.matchAll(funcRegex)];
    for (const m of funcMatches) {
      const fullMatch = m[0];
      const startPos = m.index ?? 0;
      const braceCount = (fullMatch.match(/{/g) || []).length - (fullMatch.match(/}/g) || []).length;
      
      let extractedFunc = fullMatch;
      if (braceCount !== 0 && startPos + fullMatch.length < content.length) {
        let pos = startPos + fullMatch.length;
        let depth = braceCount;
        while (pos < content.length && depth > 0) {
          if (content[pos] === '{') depth++;
          if (content[pos] === '}') depth--;
          pos++;
        }
        extractedFunc = content.slice(startPos, pos);
      }
      
      if (extractedFunc.length < 1000) {
        functionBlocks.push(extractedFunc);
      } else {
        const lines = extractedFunc.split('\n');
        functionBlocks.push(lines.slice(0, 30).join('\n') + '\n// ... [function body summarized]');
      }
    }

    // Extract struct definitions
    const structBlocks: string[] = [];
    const structRegex = /type\s+(\w+)\s+struct\s*\{[\s\S]*?\n\}/g;
    const structMatches = content.matchAll(structRegex);
    for (const m of structMatches) {
      structBlocks.push(m[0]);
    }

    // Extract interface definitions
    const interfaceBlocks: string[] = [];
    const interfaceRegex = /type\s+(\w+)\s+interface\s*\{[\s\S]*?\n\}/g;
    const interfaceMatches = content.matchAll(interfaceRegex);
    for (const m of interfaceMatches) {
      interfaceBlocks.push(m[0]);
    }

    // Build compressed content
    const parts: string[] = [];
    
    // Header with file info
    parts.push(`// File: ${filePath}`);
    parts.push(`// Original size: ~${Math.ceil(content.length / CHARS_PER_TOKEN)} tokens`);
    if (query) {
      parts.push(`// Query context: ${query}`);
    }
    parts.push('');

    // Add preserved SQL queries first
    if (sqlBlocks.length > 0) {
      parts.push('// === PRESERVED SQL QUERIES ===');
      sqlBlocks.forEach((sql, i) => {
        parts.push(`sql_${i + 1}: \`${sql}\``);
      });
      parts.push('');
    }

    // Add structs
    if (structBlocks.length > 0) {
      parts.push('// === STRUCT DEFINITIONS ===');
      parts.push(...structBlocks);
      parts.push('');
    }

    // Add interfaces
    if (interfaceBlocks.length > 0) {
      parts.push('// === INTERFACES ===');
      parts.push(...interfaceBlocks);
      parts.push('');
    }

    // Add function signatures (if not too many)
    if (functionBlocks.length > 0) {
      parts.push('// === FUNCTIONS ===');
      const totalFuncSize = functionBlocks.join('\n\n').length;
      
      if (totalFuncSize <= targetChars * 0.5) {
        // If functions fit well, include them
        parts.push(...functionBlocks);
      } else {
        // Too many functions, summarize
        for (const func of functionBlocks.slice(0, 20)) {
          if (parts.join('\n').length + func.length > targetChars) break;
          parts.push(func);
        }
        if (functionBlocks.length > 20) {
          parts.push(`// ... and ${functionBlocks.length - 20} more functions`);
        }
      }
    }

    const compressed = parts.join('\n');
    const compressedTokens = Math.ceil(compressed.length / CHARS_PER_TOKEN);

    return {
      original: content,
      compressed,
      compressionRatio: compressedTokens / Math.ceil(content.length / CHARS_PER_TOKEN),
      method: compressedTokens < Math.ceil(content.length / CHARS_PER_TOKEN) ? 'summarized' : 'partial',
    };
  }

  /**
   * Generic file summarization for other languages.
   */
  private async summarizeGeneric(
    content: string,
    filePath: string,
    language: string,
    query: string | undefined,
    maxTokens: number
  ): Promise<CompressionResult> {
    const prompt = `Compress this ${language} file while preserving semantic meaning.

File: ${filePath}
${query ? `Query context: ${query}` : ''}

Requirements:
1. Keep ALL: function signatures, class/interface definitions, type declarations, constants
2. Keep: SQL queries, regex patterns, long string literals, important comments
3. Summarize: repetitive boilerplate, long function bodies, redundant code
4. Preserve: code structure and flow

Original file (${Math.ceil(content.length / CHARS_PER_TOKEN)} tokens):

\`\`\`${language}
${content}
\`\`\`

Compressed version (max ~${maxTokens} tokens):`;

    try {
      const summary = await this.llmProvider.chat(
        this.model,
        [{ role: 'user', content: prompt }],
        undefined
      );

      const compressed = summary.trim();
      const compressedTokens = Math.ceil(compressed.length / CHARS_PER_TOKEN);

      return {
        original: content,
        compressed,
        compressionRatio: compressedTokens / Math.ceil(content.length / CHARS_PER_TOKEN),
        method: 'summarized',
      };
    } catch {
      // Fallback: aggressive truncation at logical boundaries
      return this.aggressiveTruncate(content, maxTokens);
    }
  }

  /**
   * Fallback truncation that tries to break at logical boundaries.
   */
  private aggressiveTruncate(content: string, maxTokens: number): CompressionResult {
    const maxChars = maxTokens * CHARS_PER_TOKEN * 0.9;
    
    if (content.length <= maxChars) {
      return {
        original: content,
        compressed: content,
        compressionRatio: 1,
        method: 'full',
      };
    }

    // Try to truncate at function/class boundaries
    const lines = content.split('\n');
    const keptLines: string[] = [];
    let keptChars = 0;

    for (const line of lines) {
      if (keptChars + line.length > maxChars) {
        // Check if this is a logical boundary
        if (/^(function|func|def|class|interface|struct|const|var|type)\s/.test(line.trim())) {
          keptLines.push(line);
          keptChars += line.length + 1;
        } else {
          keptLines.push('// ... [truncated]');
          break;
        }
      } else {
        keptLines.push(line);
        keptChars += line.length + 1;
      }
    }

    const compressed = keptLines.join('\n');
    const compressedTokens = Math.ceil(compressed.length / CHARS_PER_TOKEN);

    return {
      original: content,
      compressed,
      compressionRatio: compressedTokens / Math.ceil(content.length / CHARS_PER_TOKEN),
      method: 'partial',
    };
  }

  /**
   * Batch compress multiple files, ensuring total fits within budget.
   */
  async compressBatch(
    files: Array<{ path: string; content: string; language: string }>,
    totalBudget: number,
    query?: string
  ): Promise<Map<string, CompressionResult>> {
    const results = new Map<string, CompressionResult>();
    const reserved = 500; // Reserve tokens for system prompts
    const available = totalBudget - reserved;

    // First pass: compress each file individually
    for (const file of files) {
      const result = await this.compress(file.content, {
        maxTokens: Math.floor(available / files.length),
        language: file.language,
        filePath: file.path,
        query,
      });
      results.set(file.path, result);
    }

    // Second pass: check total, compress more if needed
    let totalTokens = 0;
    for (const result of results.values()) {
      totalTokens += Math.ceil(result.compressed.length / CHARS_PER_TOKEN);
    }

    if (totalTokens > available) {
      // Need to compress more - use LLM to create a unified summary
      const allCompressed = Array.from(results.entries())
        .map(([path, result]) => `// === ${path} ===\n${result.compressed}`)
        .join('\n\n');

      const summaryPrompt = `Summarize and consolidate these file contents to fit within ~${available} tokens.
Keep all important code, SQL queries, struct definitions, and function signatures.
Remove redundant boilerplate while preserving semantics.

${allCompressed}

Consolidated summary:`;

      try {
        const consolidated = await this.llmProvider.chat(
          this.model,
          [{ role: 'user', content: summaryPrompt }],
          undefined
        );

        // Update all results with consolidated version
        for (const key of results.keys()) {
          results.set(key, {
            original: results.get(key)!.original,
            compressed: consolidated,
            compressionRatio: Math.ceil(consolidated.length / CHARS_PER_TOKEN) / Math.ceil(results.get(key)!.original.length / CHARS_PER_TOKEN),
            method: 'summarized',
          });
        }
      } catch {
        // Keep individual compressions
      }
    }

    return results;
  }
}
