import React, { useState } from 'react';
import './DiffViewer.css';

interface DiffViewerProps {
  diffId: string;
  path: string;
  diff: string;
  resolved?: boolean;
  resolvedLabel?: string;
  onApprove?: (diffId: string) => void;
  onReject?: (diffId: string) => void;
}

interface DiffLine {
  type: 'added' | 'removed' | 'context' | 'header' | 'hunk';
  text: string;
}

function parseDiff(raw: string): DiffLine[] {
  return raw.split('\n').map(line => {
    if (line.startsWith('+++') || line.startsWith('---')) return { type: 'header', text: line };
    if (line.startsWith('@@'))                              return { type: 'hunk',   text: line };
    if (line.startsWith('+'))                              return { type: 'added',   text: line };
    if (line.startsWith('-'))                              return { type: 'removed', text: line };
    return { type: 'context', text: line };
  });
}

export function DiffViewer({
  diffId,
  path,
  diff,
  resolved,
  resolvedLabel,
  onApprove,
  onReject,
}: DiffViewerProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const filename = path.split('/').pop() ?? path;
  const lines = parseDiff(diff);

  return (
    <div className="diff-viewer">
      <div className="diff-viewer__header" onClick={() => setCollapsed(c => !c)}>
        <span className="diff-viewer__icon">📄</span>
        <span className="diff-viewer__filename" title={path}>{filename}</span>
        <span className="diff-viewer__path">{path}</span>
        <span className="diff-viewer__chevron">{collapsed ? '▸' : '▾'}</span>
      </div>

      {!collapsed && (
        <>
          {diff ? (
            <div className="diff-viewer__body">
              {lines.map((line, i) => (
                <div key={i} className={`diff-line diff-line--${line.type}`}>
                  <span className="diff-line__gutter">
                    {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                  </span>
                  <span className="diff-line__text">{line.text.slice(1)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="diff-viewer__empty">No diff content</div>
          )}

          <div className="diff-viewer__footer">
            {resolved ? (
              <span className="diff-viewer__resolved">{resolvedLabel}</span>
            ) : (
              <>
                <button
                  className="diff-viewer__btn diff-viewer__btn--apply"
                  onClick={() => onApprove?.(diffId)}
                >
                  ✓ Apply Changes
                </button>
                <button
                  className="diff-viewer__btn diff-viewer__btn--reject"
                  onClick={() => onReject?.(diffId)}
                >
                  ✗ Discard
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
