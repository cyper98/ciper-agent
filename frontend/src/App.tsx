import React, { useEffect } from 'react';
import { ChatPanel } from './components/ChatPanel/ChatPanel';
import { sendToExtension } from './vscodeApi';

export default function App(): JSX.Element {
  useEffect(() => {
    // Signal to the extension that the webview is mounted and ready
    sendToExtension({ kind: 'READY' });
  }, []);

  return (
    <div className="app">
      <ChatPanel />
    </div>
  );
}
