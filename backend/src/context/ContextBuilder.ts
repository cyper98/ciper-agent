import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ContextPayload, ContextFile } from '@ciper-agent/shared';
import { TokenBudget, ScoredContent } from './TokenBudget';
import { FileRanker } from './FileRanker';
import { getGitDiff } from './GitContextProvider';
import { resolveLocalImports, resolveNestedDependencies } from './import-dependency-resolver';
import { ContextCompressor } from './ContextCompressor';
import { LlmProvider } from '../llm/providers/LlmProvider';
import { ModelManager } from '../llm/ModelManager';

/** High token limits - compression handles overflow */
const TOKEN_LIMITS: Record<string, number> = {
  go:   12000,
  ts:   10000,
  tsx:  10000,
  js:   10000,
  py:   10000,
  rs:   10000,
  default: 8000,
};

function getTokenLimit(language: string): number {
  return TOKEN_LIMITS[language] ?? TOKEN_LIMITS.default;
}

export class ContextBuilder {
  private fileRanker = new FileRanker();
  private compressor: ContextCompressor | null = null;

  constructor(
    private budget: TokenBudget,
    private llmProvider?: LlmProvider,
    private modelManager?: ModelManager
  ) {
    if (llmProvider && modelManager) {
      this.compressor = new ContextCompressor(llmProvider, modelManager.getSelectedModel());
    }
  }

  async build(options: {
    workspaceRoot: string;
    selectedText?: string;
    attachedFiles?: string[];
    query?: string;
  }): Promise<ContextPayload> {
    const { workspaceRoot, selectedText, attachedFiles = [], query } = options;
    const activeEditor = vscode.window.activeTextEditor;

    // 1. Active file (highest priority) - READ FULL CONTENT
    let activeFile: ContextFile | undefined;
    if (activeEditor) {
      const doc = activeEditor.document;
      const language = doc.languageId;
      const maxTokens = getTokenLimit(language);
      let content = doc.getText();
      
      // Compress if needed
      if (this.compressor && content.length > maxTokens * 4) {
        const result = await this.compressor.compress(content, {
          maxTokens,
          language,
          filePath: path.relative(workspaceRoot, doc.fileName),
          query,
        });
        content = result.compressed;
      }
      
      activeFile = {
        path: path.relative(workspaceRoot, doc.fileName),
        content,
        language,
      };
    }

    // 2. Visible editors excluding active
    const openFiles: ContextFile[] = [];
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor === activeEditor) continue;
      const doc = editor.document;
      if (doc.uri.scheme !== 'file') continue;
      
      const maxTokens = getTokenLimit(doc.languageId);
      let content = doc.getText();
      
      if (this.compressor && content.length > maxTokens * 4) {
        const result = await this.compressor.compress(content, {
          maxTokens,
          language: doc.languageId,
          filePath: path.relative(workspaceRoot, doc.fileName),
          query,
        });
        content = result.compressed;
      }
      
      openFiles.push({
        path: path.relative(workspaceRoot, doc.fileName),
        content,
        language: doc.languageId,
      });
      if (openFiles.length >= 4) break;
    }

    // 3. Auto-discover imported local dependency files
    // For Go files with complex nested service/repository chains, use deep resolution
    const depFiles: ContextFile[] = [];
    if (activeEditor) {
      const absActivePath = activeEditor.document.fileName;
      const sourceText = activeEditor.document.getText();
      const isGo = absActivePath.endsWith('.go');
      
      let depPaths: string[];
      
      // Use deep resolution for Go files to trace service -> repository chains
      if (isGo) {
        const nestedDeps = resolveNestedDependencies(absActivePath, 6);
        depPaths = Array.from(nestedDeps.keys()).filter(p => p !== absActivePath);
      } else {
        depPaths = resolveLocalImports(sourceText, absActivePath, 2);
      }
      
      const depResults = await Promise.all(
        depPaths.map(async (absPath): Promise<ContextFile | null> => {
          try {
            let content = await fs.promises.readFile(absPath, 'utf8');
            const rel = path.relative(workspaceRoot, absPath);
            const ext = path.extname(absPath).slice(1) || 'text';
            const isGoDep = absPath.endsWith('.go');
            const maxTokens = isGoDep ? 12000 : getTokenLimit(ext);
            
            if (this.compressor && content.length > maxTokens * 4) {
              const result = await this.compressor.compress(content, {
                maxTokens,
                language: ext,
                filePath: rel,
                query,
              });
              content = result.compressed;
            }
            
            return { path: rel, content, language: ext };
          } catch {
            return null;
          }
        })
      );
      depFiles.push(...depResults.filter((f): f is ContextFile => f !== null));
    }

    // 4. Attached file reads + git diff
    const [gitDiff, ...attachedResults] = await Promise.all([
      getGitDiff(workspaceRoot),
      ...attachedFiles.map(async (relPath): Promise<ContextFile | null> => {
        try {
          let content = await fs.promises.readFile(path.resolve(workspaceRoot, relPath), 'utf8');
          const ext = path.extname(relPath).slice(1) || 'text';
          // Attached files get even more generous limits
          const maxTokens = 15000;
          
          if (this.compressor && content.length > maxTokens * 4) {
            const result = await this.compressor.compress(content, {
              maxTokens,
              language: ext,
              filePath: relPath,
              query,
            });
            content = result.compressed;
          }
          
          return { path: relPath, content, language: ext };
        } catch {
          return null;
        }
      }),
    ]);
    const attached = attachedResults.filter((f): f is ContextFile => f !== null);

    // 5. Fit into token budget (now using actual compressed content)
    const items: ScoredContent[] = [];

    if (activeFile) {
      items.push({ content: activeFile.content, label: `active:${activeFile.path}`, priority: 100 });
    }

    for (const f of attached) {
      items.push({ content: f.content, label: `attached:${f.path}`, priority: 95 });
    }

    if (selectedText) {
      items.push({ content: selectedText, label: 'selection', priority: 90 });
    }

    const sortedDepFiles = [...depFiles].sort((a, b) => {
      if (a.path.endsWith('.go') && !b.path.endsWith('.go')) return -1;
      if (!a.path.endsWith('.go') && b.path.endsWith('.go')) return 1;
      return 0;
    });
    
    for (const f of sortedDepFiles) {
      const isSameDir = activeFile && path.dirname(activeFile.path) === path.dirname(f.path);
      const priority = isSameDir ? 78 : 70;
      items.push({ content: f.content, label: `dep:${f.path}`, priority });
    }

    for (const f of openFiles) {
      items.push({ content: f.content, label: `open:${f.path}`, priority: 60 });
    }

    if (gitDiff) {
      items.push({ content: gitDiff, label: 'git:diff', priority: 40 });
    }

    const fitted = this.budget.fitContent(items);
    const tokenCount = this.budget.totalTokens(fitted);

    return {
      activeFile,
      openFiles,
      attachedFiles: attached,
      depFiles,
      gitDiff,
      workspaceRoot,
      selectedText,
      tokenCount,
    };
  }

  format(ctx: ContextPayload): string {
    const parts: string[] = [];

    parts.push(`Workspace root: ${ctx.workspaceRoot}`);

    if (ctx.activeFile) {
      parts.push(
        `\n### Active File: ${ctx.activeFile.path} (${ctx.activeFile.language})\n` +
          '```' + ctx.activeFile.language + '\n' +
          ctx.activeFile.content + '\n```'
      );
    }

    if (ctx.selectedText) {
      parts.push(`\n### Selected Text:\n\`\`\`\n${ctx.selectedText}\n\`\`\``);
    }

    if (ctx.attachedFiles.length > 0) {
      for (const f of ctx.attachedFiles) {
        parts.push(
          `\n### Attached File: ${f.path}\n` +
            '```' + f.language + '\n' + f.content + '\n```'
        );
      }
    }

    if (ctx.depFiles?.length > 0) {
      for (const f of ctx.depFiles) {
        parts.push(
          `\n### Imported Dependency: ${f.path}\n` +
            '```' + f.language + '\n' + f.content + '\n```'
        );
      }
    }

    if (ctx.openFiles.length > 0) {
      const fileList = ctx.openFiles.map(f => `- ${f.path}`).join('\n');
      parts.push(`\n### Other Open Files:\n${fileList}`);
    }

    if (ctx.gitDiff) {
      parts.push(`\n### Current Git Diff (HEAD):\n\`\`\`diff\n${ctx.gitDiff}\n\`\`\``);
    }

    return parts.join('\n');
  }
}
