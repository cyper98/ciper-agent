import React, { useState, useMemo } from 'react';
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

function countChanges(lines: DiffLine[]): { added: number; removed: number } {
  return lines.reduce(
    (acc, line) => {
      if (line.type === 'added') acc.added++;
      if (line.type === 'removed') acc.removed++;
      return acc;
    },
    { added: 0, removed: 0 }
  );
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
  const lines = useMemo(() => parseDiff(diff), [diff]);
  const stats = useMemo(() => countChanges(lines), [lines]);

  const isApproved = resolvedLabel?.toLowerCase().includes('approved') ?? false;
  const isRejected = resolvedLabel?.toLowerCase().includes('rejected') ?? false;

  return (
    <div className="diff-viewer">
      <div className="diff-viewer__header" onClick={() => setCollapsed(c => !c)}>
        <span className="diff-viewer__icon">📄</span>
        <span className="diff-viewer__filename" title={path}>{filename}</span>
        <span className="diff-viewer__path">{path}</span>
        
        {diff && !collapsed && (
          <div className="diff-viewer__stats">
            {stats.added > 0 && (
              <span className="diff-viewer__stat--added">+{stats.added}</span>
            )}
            {stats.removed > 0 && (
              <span className="diff-viewer__stat--removed">-{stats.removed}</span>
            )}
          </div>
        )}
        
        <span className={`diff-viewer__chevron ${collapsed ? 'diff-viewer__chevron--collapsed' : ''}`}>
          ▾
        </span>
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
              <span className={`diff-viewer__resolved ${isApproved ? 'diff-viewer__resolved--success' : isRejected ? 'diff-viewer__resolved--rejected' : ''}`}>
                {isApproved && '✓ '}
                {isRejected && '✗ '}
                {resolvedLabel}
              </span>
            ) : (
              <>
                <button
                  className="diff-viewer__btn diff-viewer__btn--reject"
                  onClick={(e) => {
                    e.stopPropagation();
                    onReject?.(diffId);
                  }}
                >
                  ✗ Discard
                </button>
                <button
                  className="diff-viewer__btn diff-viewer__btn--apply"
                  onClick={(e) => {
                    e.stopPropagation();
                    onApprove?.(diffId);
                  }}
                >
                  ✓ Apply Changes
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
