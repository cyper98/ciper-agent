import * as vscode from 'vscode';
import * as path from 'path';
import { OllamaClient } from '../llm/OllamaClient';
import { ModelManager } from '../llm/ModelManager';
import { buildCompletionPrompt, buildChatCompletionPrompt } from '../prompts/templates/completion';

const COMPLETION_TIMEOUT_MS = 2000;

export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private debounceMs: number;

  constructor(
    private ollamaClient: OllamaClient,
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

  private getCompletion(
    prefix: string,
    suffix: string,
    language: string,
    filePath: string,
    token: vscode.CancellationToken
  ): Promise<string | undefined> {
    return new Promise((resolve) => {
      // Clear previous debounce
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
          const prompt = buildChatCompletionPrompt({ prefix, suffix, language, filePath });
          const model = this.modelManager.getCompletionModel();

          const messages = [{ role: 'user' as const, content: prompt }];

          let result = '';
          for await (const token of this.ollamaClient.streamChat(
            model,
            messages,
            abortController.signal
          )) {
            result += token;
            // Stop if we have a reasonable completion (newline or 100 chars)
            if (result.includes('\n\n') || result.length > 200) break;
          }

          clearTimeout(timeoutId);
          resolve(result.trim() || undefined);
        } catch {
          clearTimeout(timeoutId);
          resolve(undefined);
        }
      }, this.debounceMs);
    });
  }
}
