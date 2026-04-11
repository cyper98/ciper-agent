import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ContextPayload, ContextFile } from '@ciper-agent/shared';
import { TokenBudget, ScoredContent } from './TokenBudget';
import { FileRanker } from './FileRanker';
import { getGitDiff } from './GitContextProvider';
import { resolveLocalImports } from './import-dependency-resolver';


export class ContextBuilder {
  private fileRanker = new FileRanker();

  constructor(private budget: TokenBudget) {}

  async build(options: {
    workspaceRoot: string;
    selectedText?: string;
    attachedFiles?: string[];   // relative paths explicitly chosen by the user
  }): Promise<ContextPayload> {
    const { workspaceRoot, selectedText, attachedFiles = [] } = options;
    const activeEditor = vscode.window.activeTextEditor;

    // 1. Active file (highest priority)
    let activeFile: ContextFile | undefined;
    if (activeEditor) {
      const doc = activeEditor.document;
      activeFile = {
        path: path.relative(workspaceRoot, doc.fileName),
        content: this.budget.truncate(doc.getText(), 2000),
        language: doc.languageId,
      };
    }

    // 2. Visible editors excluding active
    const openFiles: ContextFile[] = [];
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor === activeEditor) continue;
      const doc = editor.document;
      if (doc.uri.scheme !== 'file') continue;
      openFiles.push({
        path: path.relative(workspaceRoot, doc.fileName),
        content: this.budget.truncate(doc.getText(), 500),
        language: doc.languageId,
      });
      if (openFiles.length >= 4) break;
    }

    // 2b. Auto-discover imported local dependency files from the active file.
    // These are resolved from import/require statements — npm packages are ignored.
    const depFiles: ContextFile[] = [];
    if (activeEditor) {
      const absActivePath = activeEditor.document.fileName;
      const sourceText = activeEditor.document.getText();
      const depPaths = resolveLocalImports(sourceText, absActivePath);
      const depResults = await Promise.all(
        depPaths.map(async (absPath): Promise<ContextFile | null> => {
          try {
            const content = await fs.promises.readFile(absPath, 'utf8');
            const rel = path.relative(workspaceRoot, absPath);
            const ext = path.extname(absPath).slice(1) || 'text';
            return { path: rel, content: this.budget.truncate(content, 1200), language: ext };
          } catch {
            return null;
          }
        })
      );
      depFiles.push(...depResults.filter((f): f is ContextFile => f !== null));
    }

    // 3 & 4. Attached file reads + git diff — run in parallel to avoid blocking the event loop
    const [gitDiff, ...attachedResults] = await Promise.all([
      getGitDiff(workspaceRoot),
      ...attachedFiles.map(async (relPath): Promise<ContextFile | null> => {
        try {
          const absPath = path.resolve(workspaceRoot, relPath);
          const content = await fs.promises.readFile(absPath, 'utf8');
          const ext = path.extname(relPath).slice(1) || 'text';
          return { path: relPath, content: this.budget.truncate(content, 4000), language: ext };
        } catch {
          return null; // File not readable — skip silently
        }
      }),
    ]);
    const attached = attachedResults.filter((f): f is ContextFile => f !== null);

    // 5. Fit into token budget
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

    // Auto-discovered imports get priority between attached (95) and open tabs (60)
    for (const f of depFiles) {
      items.push({ content: f.content, label: `dep:${f.path}`, priority: 80 });
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
