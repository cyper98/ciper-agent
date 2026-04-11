import type { FrontendMessage, BackendMessage } from '@ciper-agent/shared';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

// acquireVsCodeApi() must only be called ONCE per webview lifetime
const vscode = acquireVsCodeApi();

export function sendToExtension(message: FrontendMessage): void {
  vscode.postMessage(message);
}

export function onExtensionMessage(
  handler: (message: BackendMessage) => void
): () => void {
  const listener = (event: MessageEvent) => {
    handler(event.data as BackendMessage);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

export const vsCodeState = {
  get: (): unknown => vscode.getState(),
  set: (s: unknown): void => vscode.setState(s),
};
