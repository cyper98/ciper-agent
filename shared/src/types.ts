// =============================================================================
// Shared Message Protocol & Types — Ciper Agent
// Imported by both backend (extension host) and frontend (webview)
// =============================================================================

// ---------------------------------------------------------------------------
// Agent State Machine
// ---------------------------------------------------------------------------
export type AgentState = 'IDLE' | 'PLAN' | 'ACT' | 'OBSERVE' | 'REFLECT' | 'DONE' | 'ERROR';

// ---------------------------------------------------------------------------
// Tool Actions (what the model can request)
// ---------------------------------------------------------------------------
export type ToolAction =
  | { type: 'read_file';    path: string }
  | { type: 'write_file';   path: string; content: string }
  | { type: 'edit_file';    path: string; diff: string }
  | { type: 'list_files';   path: string }
  | { type: 'search_code';  query: string; filePattern?: string }
  | { type: 'run_command';  command: string; cwd?: string };

export type ToolActionType = ToolAction['type'];

export interface ToolResult {
  ok: boolean;
  output?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Agent Response (what the LLM must output)
// ---------------------------------------------------------------------------
export type AgentActionPayload = ToolAction | { type: 'done'; message: string };

export interface AgentResponse {
  thought: string;
  action: AgentActionPayload;
}

// ---------------------------------------------------------------------------
// Chat Message (UI representation)
// ---------------------------------------------------------------------------
export type MessageRole = 'user' | 'assistant' | 'tool' | 'system';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  streaming?: boolean;
  toolAction?: ToolAction;
  toolResult?: ToolResult;
  diffId?: string;
  diffPath?: string;   // filename shown in DiffViewer header
  diffContent?: string; // raw unified diff text to render
}

// ---------------------------------------------------------------------------
// Messages: Frontend → Backend (via postMessage)
// ---------------------------------------------------------------------------
export type FrontendMessage =
  | { kind: 'SEND_MESSAGE';   content: string; mode: 'chat' | 'agent'; attachedFiles?: string[] }
  | { kind: 'CANCEL_STREAM' }
  | { kind: 'APPROVE_DIFF';   diffId: string }
  | { kind: 'REJECT_DIFF';    diffId: string }
  | { kind: 'SELECT_MODEL';   model: string }
  | { kind: 'REQUEST_MODELS' }
  | { kind: 'REQUEST_CONTEXT_SNAPSHOT' }
  | { kind: 'SAVE_HISTORY';   messages: ChatMessage[] }
  | { kind: 'CLEAR_HISTORY' }
  | { kind: 'READY' };

// ---------------------------------------------------------------------------
// Messages: Backend → Frontend (via postMessage)
// ---------------------------------------------------------------------------
export type BackendMessage =
  | { kind: 'STREAM_TOKEN';       token: string; messageId: string }
  | { kind: 'STREAM_DONE';        messageId: string }
  | { kind: 'STREAM_ERROR';       error: string; messageId: string }
  | { kind: 'AGENT_STATE';        state: AgentState; detail?: string }
  | { kind: 'TOOL_CALL';          action: ToolAction; messageId: string }
  | { kind: 'TOOL_RESULT';        result: ToolResult; messageId: string }
  | { kind: 'DIFF_PREVIEW';       diffId: string; path: string; diff: string; messageId: string }
  | { kind: 'MODELS_LIST';        models: string[]; selected: string }
  | { kind: 'CONTEXT_INFO';       tokenCount: number; budget: number }
  | { kind: 'CONTEXT_SNAPSHOT';   openFiles: string[]; hasSelection: boolean }
  | { kind: 'RESTORE_HISTORY';    messages: ChatMessage[] }
  | { kind: 'INJECT_USER_MESSAGE'; content: string; mode: 'chat' | 'agent' };

export type BackendMessageKind = BackendMessage['kind'];
export type FrontendMessageKind = FrontendMessage['kind'];

// ---------------------------------------------------------------------------
// Context Payload
// ---------------------------------------------------------------------------
export interface ContextFile {
  path: string;
  content: string;
  language: string;
}

export interface ContextPayload {
  activeFile?: ContextFile;
  openFiles: ContextFile[];
  attachedFiles: ContextFile[];   // explicitly attached by the user — included with full content
  gitDiff: string;
  workspaceRoot: string;
  selectedText?: string;
  tokenCount: number;
}

// ---------------------------------------------------------------------------
// Diff Change
// ---------------------------------------------------------------------------
export interface DiffChange {
  diffId: string;
  filePath: string;
  diff: string;
  oldContent: string;
  newContent: string;
}
