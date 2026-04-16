import React from 'react';
import { AgentState } from '@ciper-agent/shared';
import './StatusBar.css';

interface StatusBarProps {
  agentState: AgentState;
  selectedModel: string;
  models: string[];
  provider: string;
  contextInfo: { tokenCount: number; budget: number } | null;
  onCancel: () => void;
  onSelectModel: (model: string) => void;
  onSelectProvider: (provider: string) => void;
}

export function StatusBar({
  agentState,
  selectedModel,
  models,
  provider,
  contextInfo,
  onSelectModel,
  onSelectProvider,
}: StatusBarProps): JSX.Element {
  const isRunning = agentState !== 'IDLE' && agentState !== 'DONE' && agentState !== 'ERROR';

  return (
    <div className="status-bar">
      {/* Provider selector */}
      <div className="status-bar__provider">
        <select
          className="status-bar__provider-select"
          value={provider}
          onChange={e => onSelectProvider(e.target.value)}
          disabled={isRunning}
          title="Switch LLM provider"
        >
          <option value="ollama">Ollama</option>
          <option value="anthropic">Claude</option>
          <option value="openai">OpenAI</option>
        </select>
      </div>

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
          <span className="status-bar__model-name" title="Waiting for model…">
            {provider === 'ollama' ? 'Loading models…' : 'Select provider first'}
          </span>
        )}
        {models.length === 0 && (
          <span className="status-bar__ollama-warn" title="No models available">⚠</span>
        )}
      </div>

      {/* Right side - only show tokens when idle */}
      <div className="status-bar__right">
        {contextInfo && !isRunning && (
          <span className="status-bar__tokens" title="Context token usage">
            {contextInfo.tokenCount.toLocaleString()}/{contextInfo.budget.toLocaleString()} tk
          </span>
        )}
      </div>
    </div>
  );
}
