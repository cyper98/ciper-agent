import * as vscode from 'vscode';
import * as path from 'path';
import { LlmProvider, LlmCallOptions } from '../llm/providers/LlmProvider';
import { ModelManager } from '../llm/ModelManager';
import { buildCompletionPrompt, buildChatCompletionPrompt, buildContextAwareCompletionPrompt } from '../prompts/templates/completion';
import { getGitDiff } from '../context/GitContextProvider';

const COMPLETION_TIMEOUT_MS = 2000;
// Small context window for completions — prefix ≤ 50 lines + suffix + prompt overhead
const COMPLETION_LLM_OPTS: LlmCallOptions = { numCtx: 4096, numPredict: 200, keepAlive: -1 };

export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private debounceMs: number;

  constructor(
    private llmProvider: LlmProvider,
    private modelManager: ModelManager
  ) {
    this.debounceMs = vscode.workspace
      .getConfiguration('ciperAgent')
      .get<number>('completionDebounceMs', 300);
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    // Only trigger on explicit request or automatic
    if (
      !vscode.workspace
        .getConfiguration('ciperAgent')
        .get<boolean>('enableInlineCompletions', true)
    ) {
      return undefined;
    }

    // Don't complete in strings/comments (basic heuristic)
    const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
    if (linePrefix.trim().startsWith('//') || linePrefix.trim().startsWith('*')) {
      return undefined;
    }

    if (token.isCancellationRequested) return undefined;

    // Build prefix (up to 50 lines before cursor)
    const startLine = Math.max(0, position.line - 50);
    const prefix = document.getText(
      new vscode.Range(new vscode.Position(startLine, 0), position)
    );

    // Build suffix (up to 20 lines after cursor)
    const endLine = Math.min(document.lineCount - 1, position.line + 20);
    const suffix = document.getText(
      new vscode.Range(position, new vscode.Position(endLine, document.lineAt(endLine).text.length))
    );

    const language = document.languageId;
    const filePath = path.relative(
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
      document.fileName
    );

    try {
      const completion = await this.getCompletion(prefix, suffix, language, filePath, token);
      if (!completion || token.isCancellationRequested) return undefined;

      return [
        new vscode.InlineCompletionItem(
          completion,
          new vscode.Range(position, position)
        ),
      ];
    } catch {
      return undefined;
    }
  }

  private async getCompletion(
    prefix: string,
    suffix: string,
    language: string,
    filePath: string,
    token: vscode.CancellationToken
  ): Promise<string | undefined> {
    return new Promise((resolve) => {
      clearTimeout(this.debounceTimer);

      this.debounceTimer = setTimeout(async () => {
        if (token.isCancellationRequested) {
          resolve(undefined);
          return;
        }

        const abortController = new AbortController();
        token.onCancellationRequested(() => abortController.abort());

        const timeoutId = setTimeout(() => {
          abortController.abort();
          resolve(undefined);
        }, COMPLETION_TIMEOUT_MS);

        try {
          const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
          
          // Get git diff for context
          let gitDiff = '';
          try {
            gitDiff = await getGitDiff(workspaceRoot);
          } catch {
            // Ignore git errors
          }

          // Get open files for framework detection
          const openFiles = vscode.window.tabGroups.all
            .flatMap(g => g.tabs)
            .map(tab => (tab.input as { uri?: vscode.Uri })?.uri?.fsPath ?? '')
            .filter(f => f && !f.startsWith(workspaceRoot) || f);

          const prompt = buildContextAwareCompletionPrompt({
            prefix,
            suffix,
            language,
            filePath,
            gitDiff: gitDiff.slice(0, 1000),
            openFiles,
          });

          const model = this.modelManager.getCompletionModel();
          const messages = [{ role: 'user' as const, content: prompt }];

          let result = '';
          for await (const chunk of this.llmProvider.streamChat(
            model,
            messages,
            abortController.signal,
            undefined,
            COMPLETION_LLM_OPTS
          )) {
            result += chunk;
            if (result.includes('\n\n') || result.length > 200) break;
          }

          clearTimeout(timeoutId);
          
          // Clean up the completion - remove any markdown artifacts
          const cleaned = this.cleanCompletion(result);
          resolve(cleaned || undefined);
        } catch {
          clearTimeout(timeoutId);
          resolve(undefined);
        }
      }, this.debounceMs);
    });
  }

  private cleanCompletion(text: string): string {
    // Remove markdown code fences if accidentally included
    let cleaned = text.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
    // Remove leading/trailing whitespace
    cleaned = cleaned.trim();
    // If the completion starts with the same word as the line, remove it
    return cleaned;
  }
}
