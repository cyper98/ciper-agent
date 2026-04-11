import React, { useState } from 'react';
import { ChatMessage as ChatMessageType } from '@ciper-agent/shared';
import { MarkdownRenderer } from './MarkdownRenderer';
import { DiffViewer } from '../DiffViewer/DiffViewer';

interface ChatMessageProps {
  message: ChatMessageType;
  streamContent?: string;
  onApproveDiff?: (diffId: string) => void;
  onRejectDiff?: (diffId: string) => void;
}

export function ChatMessage({
  message,
  streamContent,
  onApproveDiff,
  onRejectDiff,
}: ChatMessageProps): JSX.Element {
  const content = streamContent ?? message.content;
  const isStreaming = !!message.streaming && streamContent !== undefined;
  const [copied, setCopied] = useState(false);

  const copyMessage = () => {
    navigator.clipboard?.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  // Diff preview MUST be checked before role check — diff messages have role='tool'
  // but need to render as DiffViewer, not ToolMessage.
  if (message.diffId) {
    return (
      <div className="msg msg--diff">
        <DiffViewer
          diffId={message.diffId}
          path={message.diffPath ?? ''}
          diff={message.diffContent ?? ''}
          resolved={content.includes('approved') || content.includes('rejected')}
          resolvedLabel={content}
          onApprove={onApproveDiff}
          onReject={onRejectDiff}
        />
      </div>
    );
  }

  if (message.role === 'tool') {
    return <ToolMessage message={message} />;
  }

  const isUser = message.role === 'user';

  return (
    <div className={`msg msg--${message.role}`}>
      <div className="msg__avatar" aria-hidden="true">
        {isUser ? '▸' : '◈'}
      </div>
      <div className="msg__body">
        <div className="msg__meta">
          <span className="msg__name">{isUser ? 'You' : 'Ciper'}</span>
          {isStreaming && <span className="msg__typing">●●●</span>}
        </div>
        <div className="msg__content">
          {isUser ? (
            <p className="msg__user-text">{content}</p>
          ) : (
            <MarkdownRenderer content={content || (isStreaming ? '…' : '')} />
          )}
        </div>
        {!isUser && !isStreaming && content && (
          <div className="msg__actions">
            <button className="msg__action-btn" onClick={copyMessage} title="Copy response">
              {copied ? '✓' : '⧉'} {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolMessage({ message }: { message: ChatMessageType }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const action = message.toolAction;
  const result = message.toolResult;

  // Group calls and results by showing just the action summary
  if (action) {
    return (
      <div className="tool-call">
        <button className="tool-call__toggle" onClick={() => setExpanded(e => !e)}>
          <span className="tool-call__icon">⚙</span>
          <span className="tool-call__label">{formatToolLabel(action.type)}</span>
          <span className="tool-call__path">{getToolPath(action)}</span>
          <span className="tool-call__chevron">{expanded ? '▾' : '▸'}</span>
        </button>
        {expanded && (
          <pre className="tool-call__detail">{JSON.stringify(action, null, 2)}</pre>
        )}
      </div>
    );
  }

  if (result) {
    const isOk = result.ok;
    return (
      <div className={`tool-result tool-result--${isOk ? 'ok' : 'err'}`}>
        <span className="tool-result__icon">{isOk ? '✓' : '✗'}</span>
        <span className="tool-result__text">
          {isOk
            ? (result.output?.slice(0, 120) ?? 'Done') + (result.output && result.output.length > 120 ? '…' : '')
            : result.error}
        </span>
      </div>
    );
  }

  return (
    <div className="tool-result tool-result--ok">
      <span>{message.content}</span>
    </div>
  );
}

function formatToolLabel(type: string): string {
  const labels: Record<string, string> = {
    read_file: 'Reading file',
    write_file: 'Writing file',
    edit_file: 'Editing file',
    list_files: 'Listing files',
    search_code: 'Searching code',
    run_command: 'Running command',
  };
  return labels[type] ?? type;
}

function getToolPath(action: { type: string; [key: string]: unknown }): string {
  if ('path' in action) return String(action.path);
  if ('query' in action) return String(action.query);
  if ('command' in action) return String(action.command).slice(0, 40);
  return '';
}
