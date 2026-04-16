// =============================================================================
// Shared Message Protocol & Types — Ciper Agent
// Imported by both backend (extension host) and frontend (webview)
// =============================================================================

// ---------------------------------------------------------------------------
// Agent State Machine
// ---------------------------------------------------------------------------
export type AgentState = 'IDLE' | 'PLAN' | 'ACT' | 'OBSERVE' | 'REFLECT' | 'DONE' | 'ERROR';

// ---------------------------------------------------------------------------
// Conversation Management
// ---------------------------------------------------------------------------
export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  tokenCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationSummary {
  id: string;
  title: string;
  tokenCount: number;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
  preview: string;
}

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
  diffPath?: string;    // filename shown in DiffViewer header
  diffContent?: string; // raw unified diff text to render
  workerPlan?: WorkerStatus[]; // populated for orchestrator-plan messages
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
  | { kind: 'SELECT_PROVIDER'; provider: string }
  | { kind: 'REQUEST_MODELS' }
  | { kind: 'REQUEST_CONTEXT_SNAPSHOT' }
  | { kind: 'SAVE_HISTORY';   messages: ChatMessage[] }
  | { kind: 'CLEAR_HISTORY' }
  | { kind: 'NEW_CONVERSATION' }
  | { kind: 'LOAD_CONVERSATION'; conversationId: string }
  | { kind: 'DELETE_CONVERSATION'; conversationId: string }
  | { kind: 'RENAME_CONVERSATION'; conversationId: string; title: string }
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
  | { kind: 'MODELS_LIST';        models: string[]; selected: string; provider?: string }
  | { kind: 'CONTEXT_INFO';       tokenCount: number; budget: number }
  | { kind: 'CONTEXT_SNAPSHOT';   openFiles: string[]; hasSelection: boolean }
  | { kind: 'RESTORE_HISTORY';    messages: ChatMessage[] }
  | { kind: 'RESTORE_CONVERSATIONS'; conversations: ConversationSummary[] }
  | { kind: 'CONVERSATION_LOADED'; conversation: Conversation }
  | { kind: 'INJECT_USER_MESSAGE'; content: string; mode: 'chat' | 'agent' }
  | { kind: 'WORKER_SPAWNED';     taskId: string; description: string; messageId: string }
  | { kind: 'WORKER_DONE';        taskId: string; summary: string; ok: boolean; messageId: string }
  | { kind: 'ORCHESTRATOR_PLAN';  tasks: SubTask[]; messageId: string };

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
  depFiles: ContextFile[];        // auto-discovered from import statements — included with full content
  gitDiff: string;
  workspaceRoot: string;
  selectedText?: string;
  tokenCount: number;
}

// ---------------------------------------------------------------------------
// Sub-Agent / Orchestrator Types (multi-agent parallel architecture)
// ---------------------------------------------------------------------------

/** A single unit of work assigned to one worker agent */
export interface SubTask {
  id: string;          // unique within the parent run, e.g. "w1"
  description: string; // natural-language goal for this worker
  hint?: string;       // optional suggested first tool call
}

/** Result returned from a completed worker agent run */
export interface WorkerResult {
  taskId: string;
  ok: boolean;
  summary: string;     // 1–3 sentence summary of what was accomplished
  toolResults: Array<{ tool: string; output: string }>;
  error?: string;
}

/** Worker status tracked in the frontend for live progress display */
export interface WorkerStatus {
  taskId: string;
  description: string;
  status: 'pending' | 'running' | 'done' | 'error';
  summary?: string;
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
