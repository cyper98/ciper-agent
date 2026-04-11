import * as vscode from 'vscode';

/**
 * Provides virtual document content for diff preview.
 * Registers a content provider for the 'ciper-diff' URI scheme.
 */
export class DiffPreviewProvider implements vscode.TextDocumentContentProvider {
  private contents = new Map<string, string>();
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  static readonly SCHEME = 'ciper-diff';

  setContent(uri: vscode.Uri, content: string): void {
    this.contents.set(uri.toString(), content);
    this.onDidChangeEmitter.fire(uri);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? '';
  }

  /**
   * Open a side-by-side diff view.
   */
  async showDiff(
    title: string,
    originalUri: vscode.Uri,
    modifiedContent: string
  ): Promise<void> {
    const modifiedUri = vscode.Uri.parse(
      `${DiffPreviewProvider.SCHEME}:${encodeURIComponent(title)}`
    );
    this.setContent(modifiedUri, modifiedContent);

    await vscode.commands.executeCommand(
      'vscode.diff',
      originalUri,
      modifiedUri,
      `Ciper: ${title} (proposed changes)`,
      { preview: true }
    );
  }

  dispose(): void {
    this.onDidChangeEmitter.dispose();
  }
}
