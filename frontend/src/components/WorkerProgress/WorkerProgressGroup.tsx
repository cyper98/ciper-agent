import React, { useState } from 'react';
import { WorkerStatus } from '@ciper-agent/shared';
import './WorkerProgressGroup.css';

interface Props {
  workers: WorkerStatus[];
}

function statusIcon(status: WorkerStatus['status']): string {
  switch (status) {
    case 'running': return '⏳';
    case 'done':    return '✅';
    case 'error':   return '❌';
    default:        return '⬜';
  }
}

/**
 * Renders a group of worker sub-agent progress indicators inline in the chat.
 * Shows a collapse button once all workers finish; collapsed view shows summary count.
 */
export function WorkerProgressGroup({ workers }: Props): React.ReactElement {
  const allDone = workers.every(w => w.status === 'done' || w.status === 'error');
  const [collapsed, setCollapsed] = useState(false);

  if (allDone && collapsed) {
    const doneCount = workers.filter(w => w.status === 'done').length;
    return (
      <div
        className="worker-group worker-group--collapsed"
        onClick={() => setCollapsed(false)}
        title="Click to expand worker details"
      >
        ✅ {doneCount}/{workers.length} sub-agents completed — click to expand
      </div>
    );
  }

  return (
    <div className="worker-group">
      <div className="worker-group__header">
        <span>🧠 Sub-agents</span>
        {allDone && (
          <button
            className="worker-group__collapse-btn"
            onClick={() => setCollapsed(true)}
          >
            collapse
          </button>
        )}
      </div>
      {workers.map(w => (
        <div
          key={w.taskId}
          className={`worker-item worker-item--${w.status}`}
        >
          <span className="worker-item__icon">{statusIcon(w.status)}</span>
          <span className="worker-item__id">{w.taskId}</span>
          <span className="worker-item__text">
            {w.summary ?? w.description}
          </span>
        </div>
      ))}
    </div>
  );
}
