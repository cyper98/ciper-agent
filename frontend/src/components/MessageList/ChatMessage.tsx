import React, { useState } from 'react';
import { ChatMessage as ChatMessageType, AgentState } from '@ciper-agent/shared';
import { MarkdownRenderer } from './MarkdownRenderer';
import { DiffViewer } from '../DiffViewer/DiffViewer';
import { WorkerProgressGroup } from '../WorkerProgress/WorkerProgressGroup';

interface ChatMessageProps {
  message: ChatMessageType;
  streamContent?: string;
  agentState?: AgentState;
  onApproveDiff?: (diffId: string) => void;
  onRejectDiff?: (diffId: string) => void;
}

const STATE_WORKING: Partial<Record<AgentState, string>> = {
  PLAN:    'Ciper is planning',
  ACT:     'Ciper is working',
  OBSERVE: 'Ciper is reading',
  REFLECT: 'Ciper is thinking',
};

export function ChatMessage({
  message,
  streamContent,
  agentState,
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

  // Worker-plan message: render inline sub-agent progress group
  if (message.workerPlan) {
    return (
      <div className="msg msg--tool">
        <WorkerProgressGroup workers={message.workerPlan} />
      </div>
    );
  }

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
    return (
      <div className="msg msg--tool">
        <ToolMessage message={message} />
      </div>
    );
  }

  const isUser = message.role === 'user';
  const isWorking = agentState && agentState !== 'IDLE' && agentState !== 'DONE' && agentState !== 'ERROR';
  const workingText = isWorking ? STATE_WORKING[agentState] : null;

  return (
    <div className={`msg msg--${message.role}`}>
      <div className="msg__avatar" aria-hidden="true">
        {isUser ? '▸' : '◈'}
      </div>
      <div className="msg__body">
        <div className="msg__meta">
          <span className="msg__name">{isUser ? 'You' : 'Ciper'}</span>
          {isWorking && !isStreaming && (
            <span className="msg__working">
              {workingText}
              <span className="msg__working-dots">
                <span></span><span></span><span></span>
              </span>
            </span>
          )}
          {isStreaming && (
            <span className="msg__typing">●●●</span>
          )}
        </div>
        <div className="msg__content">
          {isUser ? (
            <p className="msg__user-text">{content}</p>
          ) : (
            <MarkdownRenderer content={content || (isStreaming || isWorking ? '' : '')} />
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
  const action = message.toolAction;
  const result = message.toolResult;

  if (action) {
    return (
      <div className="tool-inline">
        <span className="tool-inline__action">
          {getToolIcon(action.type)}
          <span className="tool-inline__label">{formatToolLabel(action.type)}</span>
        </span>
        <span className="tool-inline__detail">{getToolDetail(action)}</span>
      </div>
    );
  }

  if (result) {
    const isOk = result.ok;
    return (
      <div className={`tool-inline tool-inline--${isOk ? 'ok' : 'err'}`}>
        <span className="tool-inline__action">
          <span className="tool-inline__icon">{isOk ? '✓' : '✗'}</span>
          <span className="tool-inline__label">{isOk ? 'Done' : 'Error'}</span>
        </span>
        {result.output && (
          <span className="tool-inline__detail">{truncate(result.output, 80)}</span>
        )}
      </div>
    );
  }

  return <></>;
}

function formatToolLabel(type: string): string {
  const labels: Record<string, string> = {
    read_file: 'Read',
    write_file: 'Write',
    edit_file: 'Edit',
    list_files: 'List',
    search_code: 'Search',
    run_command: 'Run',
  };
  return labels[type] ?? type;
}

function getToolIcon(type: string): string {
  const icons: Record<string, string> = {
    read_file: '📄',
    write_file: '✏️',
    edit_file: '🔧',
    list_files: '📁',
    search_code: '🔍',
    run_command: '⚡',
  };
  return icons[type] ?? '⚙';
}

function getToolDetail(action: { type: string; [key: string]: unknown }): string {
  if ('path' in action && action.path) {
    const p = String(action.path);
    const parts = p.split('/');
    if (parts.length > 2) {
      return `…/${parts.slice(-2).join('/')}`;
    }
    return p;
  }
  if ('query' in action) return String(action.query);
  if ('command' in action) return truncate(String(action.command), 50);
  return '';
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '…';
}
