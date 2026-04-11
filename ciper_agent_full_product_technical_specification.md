# Ciper Agent — Software Requirements Specification (SRS)

## 1. Introduction

### 1.1 Purpose
This document provides a complete specification for **Ciper Agent** — a VSCode Extension designed to replicate GitHub Copilot Agent behavior using local LLMs via Ollama.

Goals:
- Full feature parity with Copilot Agent
- Local-first (privacy-focused)
- Production-ready architecture

---

### 1.2 Scope
Ciper Agent provides:
- AI chat inside VSCode
- Automated code editing, refactoring, file generation
- Autonomous agent capable of multi-step execution
- Context-aware understanding of entire codebase

Out of scope (v1):
- Cloud inference
- Multi-user collaboration

---

### 1.3 Definitions
- Agent: System capable of planning and executing tasks
- Tool: Action callable by the AI
- Context: Data passed to the model

---

## 2. Overall Description

### 2.1 Product Perspective
System consists of 3 main layers:

1. VSCode Extension (UI + controller)
2. Agent Core Engine
3. Ollama (LLM runtime)

---

### 2.2 System Architecture

```
User
 → VSCode Extension
 → Agent Core
 → Context Builder
 → Ollama API
 → Tool Executor
 → File System
```

---

### 2.3 User Characteristics
- Software engineers
- DevOps engineers
- Backend / Frontend developers

---

## 3. Functional Requirements

## 3.1 Chat System

### 3.1.1 Basic Chat
- Multi-turn conversation
- Streaming response
- Markdown rendering
- Code highlighting

### 3.1.2 Advanced Chat
- Threaded messages
- Regenerate response
- Stop generation

---

## 3.2 Agent Mode (CORE)

### 3.2.1 Agent Loop

Mandatory flow:

1. Plan
2. Act
3. Observe
4. Reflect
5. Repeat until done

```
while not done:
  plan = model()
  action = parse(plan)
  result = execute(action)
  append(result)
```

---

### 3.2.2 Planning
Agent must:
- Analyze request
- Break into steps
- Prioritize execution

---

### 3.2.3 Reflection
- Retry on failure
- Continue if incomplete

---

## 3.3 File Editing System

### 3.3.1 Capabilities
Agent must be able to:
- Create files
- Modify files
- Delete files
- Refactor multiple files

---

### 3.3.2 Edit Flow

1. Model returns diff
2. Parse diff
3. Show preview
4. User approval
5. Apply changes

---

### 3.3.3 Diff Format
- Unified diff
- Chunk-based patch

---

## 3.4 Tool System

### 3.4.1 Tool Schema

```
type ToolAction =
  | { type: "read_file", path: string }
  | { type: "write_file", path: string, content: string }
  | { type: "edit_file", diff: string }
  | { type: "list_files", path: string }
  | { type: "search_code", query: string }
  | { type: "run_command", command: string }
```

---

### 3.4.2 Tool Requirements
- Deterministic
- Validatable
- Retry on failure

---

## 3.5 Context System (CRITICAL)

### 3.5.1 Context Sources
- Active file
- Open editors
- Workspace files
- Git diff

---

### 3.5.2 Context Strategy
- Token budget control
- Relevance ranking

---

### 3.5.3 Advanced (v2)
- Embedding search
- AST parsing

---

## 3.6 Inline Actions

- Right-click → Ask Ciper
- Hover → Fix
- Inline suggestions

---

## 3.7 Streaming System

- Token streaming from Ollama
- Cancel request

---

## 4. Ollama Integration

### 4.1 Endpoint
- http://localhost:11434

---

### 4.2 Requirements
- Streaming support
- Model selection

---

### 4.3 Supported Models
- qwen
- llama
- mistral

---

## 5. Prompt System

### 5.1 System Prompt Requirements
- Strict tool usage
- No hallucination
- Deterministic output

---

### 5.2 Output Format

```
{
  "thought": "...",
  "action": {
    "type": "edit_file",
    "input": {...}
  }
}
```

---

### 5.3 Validation
- JSON parsing
- Schema validation
- Retry on failure

---

## 6. Execution Engine

### 6.1 Responsibilities
- Manage agent loop
- Execute tools
- Maintain state

---

### 6.2 State
- Chat history
- Tool results
- Context cache

---

## 7. UI Requirements

### 7.1 Panels
- Chat panel
- Diff preview
- Logs panel

---

### 7.2 UX
- Loading states
- Error handling
- Retry

---

## 8. Security Requirements

- Confirm file changes
- Sandbox command execution
- Restrict file system access

---

## 9. Performance Requirements

- First token < 3 seconds
- Low streaming latency
- Efficient context usage

---

## 10. Reliability

- Retry mechanisms
- Fail-safe execution

---

## 11. Maintainability

- Modular architecture
- Plugin-ready

---

## 12. Scalability

- Multi-agent support (future)

---

## 13. Constraints

- Dependent on Ollama
- Limited by VRAM

---

## 14. Tech Stack

- TypeScript
- Node.js
- VSCode API

---

## 15. Folder Structure

```
ciper-agent/
 ├── extension/
 ├── core/
 ├── tools/
 ├── context/
 ├── prompts/
 └── ui/
```

---

## 16. Roadmap

### Phase 1
- Chat + Ollama

### Phase 2
- File editing

### Phase 3
- Agent loop

### Phase 4
- Optimization

---

## 17. Success Criteria

- Matches Copilot Agent behavior
- Stable performance
- Low latency

---

# 18. Implementation Blueprint (Production-ready)

## 18.1 System Prompt (STRICT)

```
You are Ciper Agent, an advanced AI coding assistant.

Rules:
- You MUST use tools for any file/system interaction
- NEVER hallucinate file content
- ALWAYS produce valid JSON
- ALWAYS follow schema
- If error → retry with fix

Output format:
{
  "thought": "short reasoning",
  "action": {
    "type": "tool_name",
    "input": { ... }
  }
}

Available tools:
- read_file
- write_file
- edit_file
- list_files
- search_code
- run_command

You must act step-by-step like an autonomous agent.
```

---

## 19. Production-Grade Implementation (Copilot-level)

### 19.1 Agent State Machine

States:
- PLAN
- ACT
- OBSERVE
- REFLECT
- DONE

---

### 19.2 Schema Validation

Use Zod to enforce strict output validation.

---

### 19.3 Retry Strategy

Retry up to 3 times if:
- JSON parsing fails
- Schema validation fails

---

### 19.4 Context Engine

- Build import graph
- Rank relevant files
- Optimize token usage

---

### 19.5 Diff Engine

- Line-level patching
- Safe apply mechanism

---

### 19.6 Guardrails

- Block dangerous commands
- Prevent path traversal

---

### 19.7 Streaming UI

- Real-time token rendering
- Chat UI (webview)

---

### 19.8 Memory System

- Short-term: session history
- Long-term: vector DB (future)

---

### 19.9 Observability

- Log actions
- Debug mode
- Replay capability

---

### 19.10 Production Checklist

- JSON validation
- Retry system
- Diff engine
- Context engine
- Streaming UI
- Security guardrails

---

END

