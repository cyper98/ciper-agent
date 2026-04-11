import React, { useEffect, useRef } from 'react';
import { ChatMessage as ChatMessageType } from '@ciper-agent/shared';
import { ChatMessage } from './ChatMessage';
import './MessageList.css';

interface MessageListProps {
  messages: ChatMessageType[];
  streamVersion: number;
  getStreamBuffer: (id: string) => string;
  onApproveDiff: (diffId: string) => void;
  onRejectDiff: (diffId: string) => void;
  onSuggestion?: (text: string) => void;
}

const SUGGESTIONS = [
  'Explain the active file',
  'Find all TODO comments in workspace',
  'List all TypeScript files',
  'What does this project do?',
];

export function MessageList({
  messages,
  streamVersion,
  getStreamBuffer,
  onApproveDiff,
  onRejectDiff,
  onSuggestion,
}: MessageListProps): JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamVersion]);

  if (messages.length === 0) {
    return (
      <div className="message-list message-list--empty">
        <div className="message-list__empty-state">
          <div className="message-list__empty-icon">◈</div>
          <p className="message-list__empty-title">Ciper Agent</p>
          <p className="message-list__empty-hint">
            Powered by your local Ollama models.<br />
            Ask anything or pick a suggestion below.
          </p>
          <div className="message-list__suggestions">
            {SUGGESTIONS.map(s => (
              <button
                key={s}
                className="message-list__suggestion"
                onClick={() => onSuggestion?.(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="message-list">
      {messages.map(msg => (
        <ChatMessage
          key={msg.id}
          message={msg}
          streamContent={msg.streaming ? getStreamBuffer(msg.id) : undefined}
          onApproveDiff={onApproveDiff}
          onRejectDiff={onRejectDiff}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
