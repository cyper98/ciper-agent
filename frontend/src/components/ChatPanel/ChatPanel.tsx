import React, { useState } from 'react';
import { useChat } from '../../hooks/useChat';
import { MessageList } from '../MessageList/MessageList';
import { InputBar } from '../InputBar/InputBar';
import { StatusBar } from '../StatusBar/StatusBar';
import './ChatPanel.css';

export function ChatPanel(): JSX.Element {
  const {
    messages,
    agentState,
    models,
    selectedModel,
    contextInfo,
    openFiles,
    hasSelection,
    streamVersion,
    getStreamBuffer,
    sendMessage,
    cancelStream,
    clearHistory,
    approveDiff,
    rejectDiff,
    selectModel,
    requestContextSnapshot,
  } = useChat();

  const [injectedInput, setInjectedInput] = useState('');

  const isRunning = agentState !== 'IDLE' && agentState !== 'DONE' && agentState !== 'ERROR';

  const handleSuggestion = (text: string) => {
    setInjectedInput(text);
  };

  return (
    <div className="chat-panel">
      {messages.length > 0 && !isRunning && (
        <div className="chat-panel__toolbar">
          <button className="chat-panel__clear-btn" onClick={clearHistory} title="Clear chat">
            Clear
          </button>
        </div>
      )}

      <MessageList
        messages={messages}
        streamVersion={streamVersion}
        getStreamBuffer={getStreamBuffer}
        onApproveDiff={approveDiff}
        onRejectDiff={rejectDiff}
        onSuggestion={handleSuggestion}
      />

      <StatusBar
        agentState={agentState}
        selectedModel={selectedModel}
        models={models}
        contextInfo={contextInfo}
        onCancel={cancelStream}
        onSelectModel={selectModel}
      />

      <InputBar
        onSend={sendMessage}
        onCancel={cancelStream}
        disabled={isRunning}
        initialValue={injectedInput}
        onInitialValueConsumed={() => setInjectedInput('')}
        openFiles={openFiles}
        hasSelection={hasSelection}
        onRequestSnapshot={requestContextSnapshot}
      />
    </div>
  );
}
