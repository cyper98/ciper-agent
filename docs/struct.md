# Ciper Agent - Application Structure Analysis

## 1. Project Overview

**Ciper Agent** là VSCode extension replicate GitHub Copilot Agent behavior sử dụng local LLMs qua [Ollama](https://ollama.com). Fully private — no data leaves your machine.

### Tech Stack
- **Backend**: TypeScript, VSCode Extension API (Node.js)
- **Frontend**: React + TypeScript (webview)
- **LLM**: Ollama API (local inference)
- **Architecture**: npm workspace monorepo (shared → frontend → backend)

---

## 2. Architecture Overview

```
ciper-agent/
├── shared/src/types.ts          # Message protocol & shared types
├── backend/src/                 # VSCode Extension Host
│   ├── extension.ts             # Entry point, DI container
│   ├── agent/                   # Agent logic
│   │   ├── AgentRunner.ts       # Main runner (chat + agent mode)
│   │   ├── AgentStateMachine.ts # State machine (PLAN→ACT→OBSERVE→REFLECT)
│   │   ├── orchestrator-agent.ts # Multi-agent orchestrator
│   │   ├── worker-agent.ts      # Single-task worker agent
│   │   ├── ResponseParser.ts    # JSON response parsing
│   │   ├── RetryStrategy.ts     # Parse error retry logic
│   │   └── ThoughtExtractor.ts  # Real-time thought streaming
│   ├── llm/                     # LLM integration
│   │   ├── OllamaClient.ts      # HTTP streaming client
│   │   ├── ModelManager.ts       # Model list & selection
│   │   ├── model-router.ts      # Role-based model routing
│   │   └── LlmCache.ts          # LLM response caching
│   ├── context/                 # Context management
│   │   ├── ContextBuilder.ts     # Build workspace context
│   │   ├── TokenBudget.ts       # Token budget + semantic truncation
│   │   ├── SemanticChunker.ts   # Semantic boundary detection
│   │   ├── FileRanker.ts        # File relevance scoring
│   │   ├── GitContextProvider.ts # Git diff retrieval
│   │   ├── import-dependency-resolver.ts # Auto-resolve imports
│   │   ├── semantic-retriever.ts # RAG retrieval
│   │   └── workspace-indexer.ts  # RAG indexing
│   ├── tools/                   # Tool execution
│   │   ├── ToolExecutor.ts      # Tool dispatcher
│   │   ├── ParallelToolExecutor.ts # Batch parallel execution
│   │   ├── ReadFileTool.ts       # File read
│   │   ├── WriteFileTool.ts      # File write (with approval)
│   │   ├── EditFileTool.ts       # Diff-based edit
│   │   ├── ListFilesTool.ts      # Directory listing
│   │   ├── SearchCodeTool.ts    # Code search
│   │   ├── RunCommandTool.ts    # Shell command
│   │   └── DiffApprovalRegistry.ts # Pending diff approvals
│   ├── diff/                    # Diff handling
│   │   ├── DiffEngine.ts        # Unified diff parsing
│   │   ├── DiffApplier.ts      # Apply diffs to files
│   │   └── DiffPreviewProvider.ts # VSCode virtual doc
│   ├── webview/                 # UI communication
│   │   ├── WebviewManager.ts     # Webview lifecycle
│   │   └── MessageBridge.ts     # Frontend↔Backend messaging
│   ├── completion/              # Inline completions
│   │   └── InlineCompletionProvider.ts # Ghost text
│   ├── security/               # Security guards
│   │   ├── PathGuard.ts         # Path traversal prevention
│   │   └── CommandBlocklist.ts  # Dangerous command blocking
│   └── prompts/                 # System prompts
│       ├── SystemPrompt.ts       # Chat prompt builder
│       └── templates/           # Orchestrator/Worker prompts
└── frontend/src/               # React webview UI
    ├── App.tsx                  # Main app
    ├── vscodeApi.ts             # postMessage wrapper
    ├── components/
    │   ├── ChatPanel/           # Main chat container
    │   ├── DiffViewer/          # Diff preview modal
    │   ├── InputBar/            # Message input + mode toggle
    │   ├── MessageList/         # Chat messages display
    │   ├── StatusBar/           # Model selector, status
    │   └── WorkerProgress/      # Multi-agent progress
    ├── hooks/                   # React hooks
    └── styles/                  # CSS
```

---

## 3. Core Features & Data Flow

### 3.1 Chat Mode
```
User Input → AgentRunner.runChat()
  → ContextBuilder.build() [active file, open files, git diff]
  → OllamaClient.streamChat() [no JSON constraint]
  → Frontend streams tokens
  → Conversation history persisted
```

### 3.2 Agent Mode (Single Agent Loop)
```
User Input → AgentRunner.runAgent()
  → OrchestratorAgent.run()
    → LLM (JSON format) → ResponseParser.parse()
    → ToolExecutor.execute()
    → Loop up to maxAgentIterations (default 20)
  → Conversation history persisted
```

### 3.3 Agent Mode (Multi-Agent Orchestrator)
```
User Input → OrchestratorAgent.run()
  → LLM decides: "sub_tasks" | "tool_call" | "done"
  → If sub_tasks:
      → Promise.allSettled(workers)
        → Each WorkerAgent: PLAN→ACT→OBSERVE loop
      → Synthesize results → continue loop
  → If tool_call: execute directly → continue loop
  → If done: return
```

### 3.4 Inline Completions
```
User types → InlineCompletionProvider.provideInlineCompletion()
  → Debounced (300ms default)
  → LLM call with 2-second timeout
  → VSCode ghost text display
```

### 3.5 Diff Approval Flow
```
LLM requests write_file/edit_file
  → DiffEngine.parse() creates old/new content
  → DiffApprovalRegistry.register() [pending]
  → Frontend shows diff preview
  → User clicks Approve/Reject
  → DiffApprovalRegistry.resolve() → DiffApplier.apply()
```

---

## 4. Message Protocol (Frontend ↔ Backend)

### Frontend → Backend
| Message | Purpose |
|---------|---------|
| `SEND_MESSAGE` | Send chat/agent message |
| `CANCEL_STREAM` | Abort LLM call |
| `APPROVE_DIFF` / `REJECT_DIFF` | Diff approval |
| `SELECT_MODEL` | Switch model |
| `REQUEST_MODELS` | Get model list |
| `SAVE_HISTORY` / `CLEAR_HISTORY` | Chat persistence |
| `READY` | Webview ready |

### Backend → Frontend
| Message | Purpose |
|---------|---------|
| `STREAM_TOKEN` / `STREAM_DONE` | LLM streaming |
| `STREAM_ERROR` | Error handling |
| `AGENT_STATE` | State machine transitions |
| `TOOL_CALL` / `TOOL_RESULT` | Tool execution |
| `DIFF_PREVIEW` | Diff display |
| `ORCHESTRATOR_PLAN` | Multi-agent plan |
| `WORKER_SPAWNED` / `WORKER_DONE` | Worker progress |
| `CONTEXT_INFO` | Token budget info |

---

## 5. Context Management

### Token Budget Allocation (default: 8192 tokens)
**NO truncation** - Full file content is read, then compressed using LLM summarization:

| Content | Read Limit | Compression |
|---------|------------|-------------|
| Active file | Full (Go: 12k, TS: 10k tokens) | LLM summarization |
| Attached files | Full (15k tokens) | LLM summarization |
| Dependencies | Full (Go: 10k, others: 8k) | LLM summarization |
| Open files | Full (8k tokens) | LLM summarization |

### Context Compression (LLM-based)
Instead of truncating (which breaks SQL queries, function bodies), files are **summarized by LLM**:
- **Go files**: Preserves SQL queries, struct definitions, function signatures
- **Other languages**: General semantic compression
- **Fallback**: Truncate at function/class boundaries

### Import Resolution (Go/Nested Services)
- **Recursive import resolution** up to 4 levels deep for Go files
- **Go module root detection** via go.mod walking
- **Max 15 dependency files** (up from 5)
- **Go files prioritized** in dependency sorting
| Imported deps | 80 | 1200 chars |
| Open files | 60 | 500 chars each (max 4) |
| Git diff | 40 | - |

### RAG Pipeline (opt-in)
1. `WorkspaceIndexer.buildIndex()` - Embed all code files
2. File watcher on save → incremental re-index
3. `SemanticRetriever.retrieve()` - Find relevant code
4. Append to context as "RAG context"

---

## 6. Security Measures

### PathGuard
- Prevents path traversal (`../`, absolute paths outside workspace)
- All file operations go through this guard

### CommandBlocklist
Blocked patterns: `rm -rf`, `sudo`, `curl | bash`, `wget | sh`, `dd if=`, fork bombs, etc.

### Diff Approval
- Default: `requireApprovalForEdits: true`
- User must explicitly approve before disk write
- Settings override available

---

## 7. Optimization Opportunities

### 7.1 High Priority - ✅ IMPLEMENTED

**a) Context Compression (Semantic Chunking)**
- ✅ Implemented: `backend/src/context/SemanticChunker.ts`
- Splits text at function/class/paragraph boundaries
- Preserves semantic coherence instead of arbitrary cuts
- Used in TokenBudget for intelligent truncation
- Also used for conversation history compression

**b) LLM Response Caching**
- ✅ Implemented: `backend/src/llm/LlmCache.ts`
- Semantic hash-based cache keys (normalizes paths, timestamps, etc.)
- TTL-based expiration (30 min default)
- LRU eviction when max entries reached
- Reduces redundant LLM calls for repeated queries

**c) Parallel Tool Execution**
- ✅ Implemented: `backend/src/tools/parallel-tool-executor.ts`
- Integrated into `OrchestratorAgent`
- Read-only tools (read_file, list_files, search_code) batched in parallel
- Write operations serialized to prevent conflicts
- Updated orchestrator to batch multiple tool calls

**d) Conversation History Compression**
- ✅ Implemented: Updated `AgentRunner.pruneHistory()`
- Older turns beyond last 10 pairs get compressed semantically
- First 2 pairs keep full content for recent context
- Reduces context overflow risk during long agent sessions

### 7.2 Medium Priority

**e) Token Budget Dynamic Reallocation**
- Current: Fixed priorities per content type
- Suggestion: Adaptive budget based on actual LLM performance feedback

**f) Streaming Optimization**
- Current: Token-by-token frontend update
- Issue: High IPC overhead for long responses
- Suggestion: Batch tokens (e.g., every 10 tokens or 50ms)

**g) RAG Index Optimization**
- Current: Re-index entire file on save
- Issue: Inefficient for large files
- Suggestion: Incremental chunk-level indexing

### 7.3 Low Priority (Nice-to-have)

**i) Model Warm-up**
- Current: First request triggers model load
- Suggestion: Pre-warm model on extension activation (background)

**j) Batch File Operations**
- Current: Individual file reads/writes
- Suggestion: Batch API for reading multiple small files

**k) Inline Completion Optimization**
- Current: Debounced + timeout
- Suggestion: Predict completion likelihood, skip LLM for obvious patterns

---

## 8. Configuration Summary

| Setting | Default | Description |
|---------|---------|-------------|
| `ollamaEndpoint` | `http://localhost:11434` | Ollama URL |
| `model` | `qwen2.5-coder:7b` | Primary model |
| `orchestratorModel` | *(uses model)* | Orchestrator model |
| `workerModel` | *(uses model)* | Worker model |
| `workerNumCtx` | `8192` | Worker context size |
| `maxWorkerAgents` | `4` | Max parallel workers |
| `contextTokenBudget` | `8192` | Context budget |
| `maxAgentIterations` | `20` | Max agent loop |
| `enableInlineCompletions` | `true` | Ghost text |
| `completionDebounceMs` | `300` | Completion delay |
| `requireApprovalForEdits` | `true` | Diff approval |
| `ragEnabled` | `false` | Semantic retrieval |

---

## 9. Unresolved Questions

1. **Orchestrator failure handling**: If orchestrator LLM fails mid-loop, conversation history is partially committed. Should implement transaction-like rollback?

2. **RAG quality metrics**: No feedback loop on retrieval quality. Should track which retrieved chunks led to successful tool calls?

3. **Model compatibility**: Smaller models (1.5b, 3b) may struggle with strict JSON output. Current retry helps, but could detect model capability at startup.

4. **Token estimation accuracy**: Using simple character-based estimation. Ollama uses tiktoken-equivalent. Should align for accurate budgeting.

5. **Cross-workspace support**: PathGuard validates against single workspace root. Multi-root workspaces may need adjustment.
