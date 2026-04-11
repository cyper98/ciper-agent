import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { BackendMessage } from '@ciper-agent/shared';
import { MessageBridge } from './MessageBridge';

export function getWebviewHtml(
  webviewUri: vscode.Uri,
  nonce: string,
  webview: vscode.Webview
): string {
  const cspSource = webview.cspSource;
  // NOTE: style-src must NOT have a nonce — when a nonce is present the browser
  // ignores 'unsafe-inline', which kills every <style> tag injected by style-loader.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             script-src 'nonce-${nonce}' ${cspSource};
             style-src ${cspSource} 'unsafe-inline';
             img-src ${cspSource} data:;
             font-src ${cspSource} data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ciper Agent</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${webviewUri}"></script>
</body>
</html>`;
}

export class WebviewManager implements vscode.WebviewViewProvider {
  public static readonly VIEW_TYPE = 'ciper.chatView';

  private view?: vscode.WebviewView;
  private bridge?: MessageBridge;

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Called by extension.ts after the bridge is constructed.
   * The bridge must be set before the webview is first opened.
   */
  setBridge(bridge: MessageBridge): void {
    this.bridge = bridge;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'media'),
      ],
    };

    // Attach the bridge NOW — before setting HTML — so the very first message
    // the webview sends (READY) is already being listened to.
    if (this.bridge) {
      this.bridge.attach(webviewView.webview);
    }

    const nonce = crypto.randomBytes(16).toString('base64');
    const webviewJsUri = webviewView.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview.js')
    );

    webviewView.webview.html = getWebviewHtml(webviewJsUri, nonce, webviewView.webview);

    webviewView.onDidDispose(() => {
      this.view = undefined;
    });
  }

  getWebview(): vscode.Webview | undefined {
    return this.view?.webview;
  }

  isVisible(): boolean {
    return this.view?.visible ?? false;
  }

  send(message: BackendMessage): void {
    this.view?.webview.postMessage(message);
  }

  reveal(): void {
    this.view?.show(true);
  }
}
