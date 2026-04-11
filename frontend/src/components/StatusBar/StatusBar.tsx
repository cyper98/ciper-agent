import React from 'react';
import { AgentState } from '@ciper-agent/shared';
import './StatusBar.css';

interface StatusBarProps {
  agentState: AgentState;
  selectedModel: string;
  models: string[];
  contextInfo: { tokenCount: number; budget: number } | null;
  onCancel: () => void;
  onSelectModel: (model: string) => void;
}

const STATE_LABELS: Partial<Record<AgentState, string>> = {
  PLAN:    'Planning…',
  ACT:     'Working…',
  OBSERVE: 'Reading…',
  REFLECT: 'Thinking…',
  DONE:    'Done',
  ERROR:   'Error',
};

export function StatusBar({
  agentState,
  selectedModel,
  models,
  contextInfo,
  onCancel,
  onSelectModel,
}: StatusBarProps): JSX.Element {
  const isRunning = agentState !== 'IDLE' && agentState !== 'DONE' && agentState !== 'ERROR';
  const stateLabel = STATE_LABELS[agentState];
  const shortModel = selectedModel.split(':')[0] || selectedModel;

  return (
    <div className="status-bar">
      {/* Model selector */}
      <div className="status-bar__model">
        {models.length > 0 ? (
          <select
            className="status-bar__model-select"
            value={selectedModel}
            onChange={e => onSelectModel(e.target.value)}
            disabled={isRunning}
            title="Switch model"
          >
            {models.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        ) : (
          <span className="status-bar__model-name" title="Waiting for Ollama…">
            Loading models…
          </span>
        )}
        {models.length === 0 && (
          <span className="status-bar__ollama-warn" title="Ollama not reachable or no models pulled">⚠</span>
        )}
      </div>

      {/* Running state */}
      {stateLabel && (
        <div className="status-bar__state">
          {isRunning && <span className="status-bar__spinner" />}
          <span>{stateLabel}</span>
        </div>
      )}

      {/* Right side */}
      <div className="status-bar__right">
        {contextInfo && !isRunning && (
          <span className="status-bar__tokens" title="Context token usage">
            {contextInfo.tokenCount.toLocaleString()}/{contextInfo.budget.toLocaleString()} tk
          </span>
        )}
        {isRunning && (
          <button className="status-bar__cancel" onClick={onCancel} title="Stop">
            ■ Stop
          </button>
        )}
      </div>
    </div>
  );
}
