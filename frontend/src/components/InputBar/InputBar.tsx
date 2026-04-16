import React, { useState, useRef, KeyboardEvent, useEffect } from 'react';
import './InputBar.css';

interface InputBarProps {
  onSend: (content: string, mode: 'chat' | 'agent', attachedFiles?: string[]) => void;
  onCancel?: () => void;
  disabled: boolean;
  initialValue?: string;
  onInitialValueConsumed?: () => void;
  openFiles?: string[];
  hasSelection?: boolean;
  onRequestSnapshot?: () => void;
}

const SLASH_COMMANDS = [
  { cmd: '/explain', hint: 'Explain the active file or selection' },
  { cmd: '/fix',     hint: 'Fix issues in the selected code' },
  { cmd: '/tests',   hint: 'Write tests for the active file' },
  { cmd: '/review',  hint: 'Review the current file for issues' },
  { cmd: '/docs',    hint: 'Add documentation to the active file' },
];

export function InputBar({
  onSend,
  onCancel,
  disabled,
  initialValue,
  onInitialValueConsumed,
  openFiles = [],
  hasSelection = false,
  onRequestSnapshot,
}: InputBarProps): JSX.Element {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'chat' | 'agent'>('chat');
  const [slashMatches, setSlashMatches] = useState<typeof SLASH_COMMANDS>([]);
  const [selectedSlash, setSelectedSlash] = useState(0);
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialValue) {
      setInput(initialValue);
      onInitialValueConsumed?.();
      textareaRef.current?.focus();
      autoGrow();
    }
  }, [initialValue]);

  useEffect(() => {
    if (!showFilePicker) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowFilePicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showFilePicker]);

  const autoGrow = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);
    autoGrow();
    if (val.startsWith('/')) {
      const query = val.toLowerCase();
      setSlashMatches(SLASH_COMMANDS.filter(c => c.cmd.startsWith(query)));
      setSelectedSlash(0);
    } else {
      setSlashMatches([]);
    }
  };

  const applySlashCommand = (cmd: string) => {
    setInput(cmd + ' ');
    setSlashMatches([]);
    textareaRef.current?.focus();
  };

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || disabled || isSending) return;
    setIsSending(true);
    const resolved = resolveSlashCommand(trimmed);
    setInput(''); // Clear input immediately before sending
    setAttachedFiles([]);
    setSlashMatches([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    onSend(resolved.text, resolved.mode ?? mode, attachedFiles.length > 0 ? attachedFiles : undefined);
    // Reset sending flag after a short delay to prevent race conditions
    setTimeout(() => setIsSending(false), 500);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashMatches.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedSlash(i => Math.min(i + 1, slashMatches.length - 1)); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSelectedSlash(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        applySlashCommand(slashMatches[selectedSlash].cmd);
        return;
      }
      if (e.key === 'Escape') { setSlashMatches([]); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const attachFile = (file: string) => {
    if (!attachedFiles.includes(file)) {
      setAttachedFiles(prev => [...prev, file]);
    }
    setShowFilePicker(false);
    textareaRef.current?.focus();
  };

  const attachAllFiles = () => {
    setAttachedFiles(openFiles);
    setShowFilePicker(false);
    textareaRef.current?.focus();
  };

  const removeFile = (file: string) => {
    setAttachedFiles(prev => prev.filter(f => f !== file));
  };

  const toggleFilePicker = () => {
    if (!showFilePicker) onRequestSnapshot?.();
    setShowFilePicker(v => !v);
  };

  const unattachedFiles = openFiles.filter(f => !attachedFiles.includes(f));
  const hasContext = hasSelection || attachedFiles.length > 0;

  return (
    <div className="input-bar">
      {slashMatches.length > 0 && (
        <div className="input-bar__slash-menu">
          {slashMatches.map((c, i) => (
            <button
              key={c.cmd}
              className={`input-bar__slash-item ${i === selectedSlash ? 'input-bar__slash-item--selected' : ''}`}
              onMouseDown={e => { e.preventDefault(); applySlashCommand(c.cmd); }}
            >
              <span className="input-bar__slash-cmd">{c.cmd}</span>
              <span className="input-bar__slash-hint">{c.hint}</span>
            </button>
          ))}
        </div>
      )}

      {showFilePicker && (
        <div className="input-bar__file-picker" ref={pickerRef}>
          <div className="input-bar__file-picker-header">
            Add file to context
            {openFiles.length > 1 && (
              <button className="input-bar__file-picker-all" onMouseDown={e => { e.preventDefault(); attachAllFiles(); }}>
                + All open files
              </button>
            )}
          </div>
          {unattachedFiles.length === 0 ? (
            <div className="input-bar__file-picker-empty">
              {openFiles.length === 0 ? 'No open files' : 'All files already attached'}
            </div>
          ) : (
            unattachedFiles.map(f => (
              <button
                key={f}
                className="input-bar__file-picker-item"
                onMouseDown={e => { e.preventDefault(); attachFile(f); }}
                title={f}
              >
                <span className="input-bar__file-picker-icon">📄</span>
                <span className="input-bar__file-picker-name">{f.split('/').pop()}</span>
                <span className="input-bar__file-picker-path">{f}</span>
              </button>
            ))
          )}
        </div>
      )}

      {hasContext && (
        <div className="input-bar__context-row">
          {hasSelection && (
            <span className="input-bar__chip input-bar__chip--selection" title="Selected text will be included as context">
              <span className="input-bar__chip-icon">✂</span>
              Selection
            </span>
          )}
          {attachedFiles.map(f => (
            <span key={f} className="input-bar__chip" title={f}>
              <span className="input-bar__chip-icon">📄</span>
              {f.split('/').pop()}
              <button
                className="input-bar__chip-remove"
                onMouseDown={e => { e.preventDefault(); removeFile(f); }}
                aria-label={`Remove ${f}`}
              >×</button>
            </span>
          ))}
        </div>
      )}

      <div className="input-bar__mode-row">
        <div className="input-bar__mode-group">
          <button
            className={`input-bar__mode-btn ${mode === 'chat' ? 'input-bar__mode-btn--active' : ''}`}
            onClick={() => setMode('chat')}
            title="Chat mode"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            Chat
          </button>
          <button
            className={`input-bar__mode-btn ${mode === 'agent' ? 'input-bar__mode-btn--active' : ''}`}
            onClick={() => setMode('agent')}
            title="Agent mode — autonomous multi-step task execution"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
            </svg>
            Agent
          </button>
        </div>
        <button
          className={`input-bar__attach-btn ${showFilePicker ? 'input-bar__attach-btn--active' : ''}`}
          onClick={toggleFilePicker}
          title="Attach file to context"
          disabled={disabled}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
          </svg>
          Attach
        </button>
        <span className="input-bar__hint">/ for commands · Enter to send</span>
      </div>

      <div className="input-bar__input-row">
        <textarea
          ref={textareaRef}
          className="input-bar__textarea"
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={mode === 'agent' ? 'Ask Ciper to perform a task…' : 'Message Ciper…'}
          disabled={disabled}
          rows={1}
        />
        {disabled ? (
          <button
            className="input-bar__send-btn input-bar__send-btn--stop"
            onClick={onCancel}
            title="Stop agent (Escape)"
            aria-label="Stop"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2"/>
            </svg>
          </button>
        ) : (
          <button
            className="input-bar__send-btn"
            onClick={handleSend}
            disabled={!input.trim()}
            title="Send (Enter)"
            aria-label="Send"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

function resolveSlashCommand(text: string): { text: string; mode?: 'chat' | 'agent' } {
  if (text.startsWith('/explain ') || text === '/explain') {
    return { text: `Explain the active file or selection in detail: ${text.slice(8).trim()}`.trimEnd(), mode: 'agent' };
  }
  if (text.startsWith('/fix ') || text === '/fix') {
    return { text: `Fix the issues in the selected code: ${text.slice(4).trim()}`.trimEnd(), mode: 'agent' };
  }
  if (text.startsWith('/tests') || text === '/tests') {
    return { text: `Write comprehensive tests for the active file${text.slice(6) ? ': ' + text.slice(6).trim() : ''}`, mode: 'agent' };
  }
  if (text.startsWith('/review')) {
    return { text: `Review the active file for bugs, code quality, and improvements${text.slice(7) ? ': ' + text.slice(7).trim() : ''}`, mode: 'agent' };
  }
  if (text.startsWith('/docs')) {
    return { text: `Add documentation (JSDoc/docstrings) to the active file${text.slice(5) ? ': ' + text.slice(5).trim() : ''}`, mode: 'agent' };
  }
  return { text };
}
