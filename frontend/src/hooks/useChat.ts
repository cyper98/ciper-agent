import { useState, useCallback, useRef } from 'react';
import { ChatMessage, AgentState, BackendMessage, ToolAction, ToolResult } from '@ciper-agent/shared';
import { sendToExtension } from '../vscodeApi';
import { useVSCodeMessage } from './useVSCodeMessage';
import { useStreaming } from './useStreaming';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface UseChatReturn {
  messages: ChatMessage[];
  agentState: AgentState;
  models: string[];
  selectedModel: string;
  contextInfo: { tokenCount: number; budget: number } | null;
  openFiles: string[];
  hasSelection: boolean;
  streamVersion: number;
  getStreamBuffer: (id: string) => string;
  sendMessage: (content: string, mode: 'chat' | 'agent', attachedFiles?: string[]) => void;
  cancelStream: () => void;
  clearHistory: () => void;
  approveDiff: (diffId: string) => void;
  rejectDiff: (diffId: string) => void;
  selectModel: (model: string) => void;
  requestContextSnapshot: () => void;
}

export function useChat(): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [agentState, setAgentState] = useState<AgentState>('IDLE');
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [contextInfo, setContextInfo] = useState<{ tokenCount: number; budget: number } | null>(null);
  const [openFiles, setOpenFiles] = useState<string[]>([]);
  const [hasSelection, setHasSelection] = useState(false);
  const activeMessageId = useRef<string | null>(null);
  // Track whether we need to persist the messages after the next state update
  const pendingSaveRef = useRef(false);

  const { getBuffer, appendToken, clearBuffer, streamVersion } = useStreaming();

  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages(prev => {
      const next = [...prev, msg];
      pendingSaveRef.current = true;
      return next;
    });
  }, []);

  const updateMessage = useCallback((id: string, updates: Partial<ChatMessage>) => {
    setMessages(prev => {
      const next = prev.map(m => (m.id === id ? { ...m, ...updates } : m));
      pendingSaveRef.current = true;
      return next;
    });
  }, []);

  // After each STREAM_DONE or message settle, save the current list to backend storage
  const saveHistory = useCallback((msgs: ChatMessage[]) => {
    sendToExtension({ kind: 'SAVE_HISTORY', messages: msgs });
  }, []);

  useVSCodeMessage((msg: BackendMessage) => {
    switch (msg.kind) {
      case 'RESTORE_HISTORY':
        // Repopulate messages from persisted storage (on panel open/VSCode restart)
        setMessages(msg.messages);
        break;

      case 'STREAM_TOKEN': {
        if (!activeMessageId.current || activeMessageId.current !== msg.messageId) {
          activeMessageId.current = msg.messageId;
          addMessage({
            id: msg.messageId,
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            streaming: true,
          });
        }
        appendToken(msg.messageId, msg.token);
        break;
      }

      case 'STREAM_DONE': {
        if (msg.messageId) {
          const finalContent = getBuffer(msg.messageId);
          // Finalize the streaming message and trigger a save
          setMessages(prev => {
            const next = prev.map(m =>
              m.id === msg.messageId
                ? { ...m, content: finalContent, streaming: false }
                : m
            );
            // Save after the streaming message is fully settled
            saveHistory(next);
            return next;
          });
          clearBuffer(msg.messageId);
          activeMessageId.current = null;
        }
        break;
      }

      case 'STREAM_ERROR': {
        const errId = msg.messageId || generateId();
        addMessage({
          id: errId,
          role: 'system',
          content: `❌ Error: ${msg.error}`,
          timestamp: Date.now(),
        });
        activeMessageId.current = null;
        break;
      }

      case 'AGENT_STATE':
        setAgentState(msg.state);
        break;

      case 'TOOL_CALL':
        addMessage({
          id: generateId(),
          role: 'tool',
          content: `🔧 Calling: ${msg.action.type}`,
          timestamp: Date.now(),
          toolAction: msg.action as ToolAction,
        });
        break;

      case 'TOOL_RESULT':
        addMessage({
          id: generateId(),
          role: 'tool',
          content: msg.result.ok
            ? `✅ ${msg.result.output?.slice(0, 200) ?? 'Done'}`
            : `❌ ${msg.result.error}`,
          timestamp: Date.now(),
          toolResult: msg.result as ToolResult,
        });
        break;

      case 'INJECT_USER_MESSAGE': {
        // Message injected from the extension host (e.g. right-click "Ask Ciper")
        const injected: ChatMessage = {
          id: generateId(),
          role: 'user',
          content: msg.content,
          timestamp: Date.now(),
        };
        setMessages(prev => {
          const next = [...prev, injected];
          saveHistory(next);
          return next;
        });
        // Immediately trigger agent/chat based on mode
        sendToExtension({ kind: 'SEND_MESSAGE', content: msg.content, mode: msg.mode });
        break;
      }

      case 'DIFF_PREVIEW':
        addMessage({
          id: msg.diffId,
          role: 'tool',
          content: `📄 Proposed changes to: ${msg.path}`,
          timestamp: Date.now(),
          diffId: msg.diffId,
          diffPath: msg.path,
          diffContent: msg.diff,
        });
        break;

      case 'CONTEXT_SNAPSHOT':
        setOpenFiles(msg.openFiles);
        setHasSelection(msg.hasSelection);
        break;

      case 'MODELS_LIST':
        setModels(msg.models);
        setSelectedModel(msg.selected);
        break;

      case 'CONTEXT_INFO':
        setContextInfo({ tokenCount: msg.tokenCount, budget: msg.budget });
        break;
    }
  });

  const sendMessage = useCallback((content: string, mode: 'chat' | 'agent', attachedFiles?: string[]) => {
    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content,
      timestamp: Date.now(),
    };
    setMessages(prev => {
      const next = [...prev, userMsg];
      saveHistory(next);
      return next;
    });
    sendToExtension({ kind: 'SEND_MESSAGE', content, mode, attachedFiles });
  }, [saveHistory]);

  const cancelStream = useCallback(() => {
    sendToExtension({ kind: 'CANCEL_STREAM' });
  }, []);

  const clearHistory = useCallback(() => {
    setMessages([]);
    sendToExtension({ kind: 'CLEAR_HISTORY' });
  }, []);

  const approveDiff = useCallback((diffId: string) => {
    sendToExtension({ kind: 'APPROVE_DIFF', diffId });
    updateMessage(diffId, { content: '✅ Changes approved and applied.' });
  }, [updateMessage]);

  const rejectDiff = useCallback((diffId: string) => {
    sendToExtension({ kind: 'REJECT_DIFF', diffId });
    updateMessage(diffId, { content: '❌ Changes rejected.' });
  }, [updateMessage]);

  const selectModel = useCallback((model: string) => {
    setSelectedModel(model);
    sendToExtension({ kind: 'SELECT_MODEL', model });
  }, []);

  const requestContextSnapshot = useCallback(() => {
    sendToExtension({ kind: 'REQUEST_CONTEXT_SNAPSHOT' });
  }, []);

  return {
    messages,
    agentState,
    models,
    selectedModel,
    contextInfo,
    openFiles,
    hasSelection,
    streamVersion,
    getStreamBuffer: getBuffer,
    sendMessage,
    cancelStream,
    clearHistory,
    approveDiff,
    rejectDiff,
    selectModel,
    requestContextSnapshot,
  };
}
