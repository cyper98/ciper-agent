import React, { useState, useRef, KeyboardEvent, useEffect } from 'react';
import './InputBar.css';

interface InputBarProps {
  onSend: (content: string, mode: 'chat' | 'agent', attachedFiles?: string[]) => void;
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

  // Close picker when clicking outside
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
    if (!trimmed || disabled) return;
    const resolved = resolveSlashCommand(trimmed);
    onSend(resolved.text, resolved.mode ?? mode, attachedFiles.length > 0 ? attachedFiles : undefined);
    setInput('');
    setAttachedFiles([]);
    setSlashMatches([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
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
      {/* Slash command popup */}
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

      {/* File picker popup */}
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

      {/* Context chips row */}
      {hasContext && (
        <div className="input-bar__context-row">
          {hasSelection && (
            <span className="input-bar__chip input-bar__chip--selection" title="Selected text will be included as context">
              ✂ Selection
            </span>
          )}
          {attachedFiles.map(f => (
            <span key={f} className="input-bar__chip" title={f}>
              📄 {f.split('/').pop()}
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
        <button
          className={`input-bar__mode-btn ${mode === 'chat' ? 'input-bar__mode-btn--active' : ''}`}
          onClick={() => setMode('chat')}
          title="Chat mode"
        >Chat</button>
        <button
          className={`input-bar__mode-btn ${mode === 'agent' ? 'input-bar__mode-btn--active' : ''}`}
          onClick={() => setMode('agent')}
          title="Agent mode — autonomous multi-step task execution"
        >⚙ Agent</button>
        <button
          className={`input-bar__attach-btn ${showFilePicker ? 'input-bar__attach-btn--active' : ''}`}
          onClick={toggleFilePicker}
          title="Attach file to context (@)"
          disabled={disabled}
        >@ file</button>
        <span className="input-bar__hint">/ for commands · Enter to send · Shift+Enter for newline</span>
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
        <button
          className="input-bar__send-btn"
          onClick={handleSend}
          disabled={disabled || !input.trim()}
          title="Send (Enter)"
          aria-label="Send"
        >
          {disabled ? (
            <span className="input-bar__stop-icon">■</span>
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1 8l14-7-5 7 5 7z"/>
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

function resolveSlashCommand(text: string): { text: string; mode?: 'chat' | 'agent' } {
  if (text.startsWith('/explain ') || text === '/explain') {
    return { text: `Explain the active file: ${text.slice(8).trim()}`.trimEnd() };
  }
  if (text.startsWith('/fix ') || text === '/fix') {
    return { text: `Fix the issues in the selected code: ${text.slice(4).trim()}`.trimEnd(), mode: 'agent' };
  }
  if (text.startsWith('/tests') || text === '/tests') {
    return { text: `Write comprehensive tests for the active file${text.slice(6) ? ': ' + text.slice(6).trim() : ''}`, mode: 'agent' };
  }
  if (text.startsWith('/review')) {
    return { text: `Review the active file for bugs, code quality, and improvements${text.slice(7) ? ': ' + text.slice(7).trim() : ''}` };
  }
  if (text.startsWith('/docs')) {
    return { text: `Add documentation (JSDoc/docstrings) to the active file${text.slice(5) ? ': ' + text.slice(5).trim() : ''}`, mode: 'agent' };
  }
  return { text };
}
