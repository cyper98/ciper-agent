# Ciper Agent

A VSCode extension that replicates GitHub Copilot Agent behavior using local LLMs via [Ollama](https://ollama.com). Fully private — no data leaves your machine.

---

## Requirements

- [Node.js](https://nodejs.org) v18+
- [Ollama](https://ollama.com) installed and running
- VSCode 1.90+

---

## Quick Start

### 1. Install Ollama and pull a model

```bash
# Install Ollama (Linux/macOS)
curl -fsSL https://ollama.com/install.sh | sh

# Pull a recommended model (good balance of speed and capability)
ollama pull qwen2.5-coder:7b

# Or for a more capable model (needs more VRAM)
ollama pull qwen2.5-coder:14b
```

Verify Ollama is running:
```bash
curl http://localhost:11434/api/tags
```

### 2. Build the extension

```bash
# Clone and install dependencies
cd ciper-agent
npm install

# Build all packages (shared types → webview → extension)
npm run build
```

### 3. Run the extension in VSCode

Press **F5** inside VSCode (with the `ciper-agent` folder open).

This launches an **Extension Development Host** — a second VSCode window with Ciper Agent loaded.

---

## Project Structure

```
ciper-agent/
├── shared/          # Shared TypeScript types (message protocol)
├── backend/         # The VSCode extension (Node.js, extension host)
│   ├── src/         # Extension source code
│   ├── dist/        # Compiled extension bundle (extension.js)
│   └── media/       # Webview bundle (webview.js) — built by frontend
└── frontend/        # React chat UI (builds into backend/media/)
    └── src/
```

The `frontend/` and `backend/` are separate packages in an npm workspace monorepo. When you run `npm run build`, the output is:

| File | What it is |
|------|-----------|
| `backend/dist/extension.js` | Extension host bundle — runs in VSCode's Node.js process |
| `backend/media/webview.js` | React UI bundle — runs in VSCode's webview (Chromium) |

---

## Using the Extension

### Opening the Chat Panel

Three ways to open the Ciper panel:

| Method | How |
|--------|-----|
| Activity Bar | Click the **◈** icon in the left sidebar |
| Keyboard shortcut | `Ctrl+Alt+I` (Mac: `Cmd+Alt+I`) |
| Command Palette | `Ctrl+Shift+P` → `Ciper: Open Ciper Chat` |

### Chat Mode vs Agent Mode

The input bar has two modes, toggled with the **Chat / Agent** buttons:

**Chat** — Conversational. Ask questions about your code, get explanations, request snippets. The model responds directly without executing any tools.

**Agent** — Autonomous. Ciper plans, reads files, edits code, runs commands, and reflects until the task is complete. Use this for multi-step tasks like "refactor this module" or "add tests for X".

### Right-Click Menu

Select any code in the editor, right-click, and choose:

- **Ask Ciper** — sends the selected code + your question to the agent
- **Fix with Ciper** — asks the agent to fix the current line

Keyboard shortcut for Ask Ciper with selection: `Ctrl+Shift+I`

### Inline Completions (Ghost Text)

As you type, Ciper suggests completions in grey ghost text — the same as Copilot. Press **Tab** to accept.

Inline completions use a lightweight, debounced LLM call with a 2-second timeout so they don't slow down typing.

---

## Agent Mode: How It Works

When you send a message in Agent mode, Ciper runs an autonomous loop:

```
1. PLAN    — model reasons about what to do next
2. ACT     — calls a tool (read file, edit file, run command, etc.)
3. OBSERVE — receives the tool result
4. REFLECT — decides whether the task is done or needs another step
5. Repeat  — up to 20 iterations (configurable)
```

You can see each step in the chat panel: tool calls are shown as `🔧 Calling: read_file` and results appear inline.

### Available Tools

| Tool | What it does |
|------|-------------|
| `read_file` | Reads a file from the workspace |
| `write_file` | Creates or overwrites a file (with diff preview) |
| `edit_file` | Applies a unified diff patch to a file (with diff preview) |
| `list_files` | Lists directory contents |
| `search_code` | Searches for a pattern across workspace files |
| `run_command` | Runs a shell command in the workspace root |

### Approving File Changes

When the agent wants to write or edit a file, it **pauses and shows a diff preview** in the chat panel. You must click **✓ Apply Changes** before anything is written to disk.

To disable approval (auto-apply all changes):
```json
// .vscode/settings.json
{
  "ciperAgent.requireApprovalForEdits": false
}
```

### Stopping the Agent

- Click the **■ Stop** button in the status bar at the bottom of the chat panel
- Or run `Ciper: Stop Agent` from the Command Palette

---

## Configuration

Open VSCode settings (`Ctrl+,`) and search for **Ciper** to see all options.

| Setting | Default | Description |
|---------|---------|-------------|
| `ciperAgent.ollamaEndpoint` | `http://localhost:11434` | Ollama API URL |
| `ciperAgent.model` | `qwen2.5-coder:7b` | Model for chat and agent mode |
| `ciperAgent.completionModel` | *(uses main model)* | Separate model for inline completions |
| `ciperAgent.contextTokenBudget` | `8192` | Max tokens used for workspace context |
| `ciperAgent.maxAgentIterations` | `20` | Max agent loop iterations before stopping |
| `ciperAgent.enableInlineCompletions` | `true` | Enable/disable ghost text completions |
| `ciperAgent.completionDebounceMs` | `300` | Delay before triggering inline completion |
| `ciperAgent.requireApprovalForEdits` | `true` | Show diff preview before applying file changes |

### Switching Models

The status bar at the bottom of the chat panel shows the active model. Click the model name to open a dropdown of all models available in your Ollama installation.

Or set it in settings:
```json
{
  "ciperAgent.model": "llama3.2:3b",
  "ciperAgent.completionModel": "qwen2.5-coder:1.5b"
}
```

### Recommended Models

| Model | VRAM | Best for |
|-------|------|---------|
| `qwen2.5-coder:1.5b` | ~2GB | Inline completions (fast) |
| `qwen2.5-coder:7b` | ~5GB | General coding (recommended default) |
| `qwen2.5-coder:14b` | ~9GB | Complex agent tasks |
| `llama3.2:3b` | ~3GB | Fast chat |
| `mistral:7b` | ~5GB | General purpose |

---

## Packaging as a .vsix

To install the extension permanently (not just in dev mode):

```bash
# Install vsce if you don't have it
npm install -g @vscode/vsce

# From the repo root — builds everything then packages
npm run package
```

This produces `backend/ciper-agent-0.1.0.vsix`. Install it:

```bash
code --install-extension backend/ciper-agent-0.1.0.vsix
```

Or in VSCode: `Extensions` panel → `...` menu → `Install from VSIX...`

---

## Development

### Watch Mode

Run both the extension and webview in watch mode simultaneously:

```bash
npm run watch
```

Then press **F5** to launch the Extension Development Host. Changes to source files will recompile automatically — reload the host window (`Ctrl+R`) to pick them up.

### Build a single package

```bash
npm run build -w shared    # Shared types only
npm run build -w frontend  # React webview only (outputs to backend/media/)
npm run build -w backend   # Extension host only
```

### Folder responsibilities

| Folder | Language | Runs in | Has access to |
|--------|----------|---------|---------------|
| `backend/src/` | TypeScript | VSCode Extension Host (Node.js) | VSCode API, filesystem, child_process, Ollama HTTP |
| `frontend/src/` | TypeScript + React | Webview (Chromium sandbox) | DOM, React — communicates with backend via `postMessage` only |
| `shared/src/` | TypeScript | Compile-time only | Shared by both — defines the message protocol |

---

## Troubleshooting

**Ciper panel is blank / not loading**
- Make sure you ran `npm run build` before pressing F5
- Check the Extension Development Host's developer console (`Help → Toggle Developer Tools`) for errors

**"No models available" in the status bar**
- Verify Ollama is running: `curl http://localhost:11434/api/tags`
- Check the endpoint setting matches your Ollama install: `ciperAgent.ollamaEndpoint`

**Inline completions not appearing**
- They are debounced by 300ms and have a 2-second timeout — pause briefly after typing
- Check `ciperAgent.enableInlineCompletions` is `true`
- For faster completions, set a small dedicated model: `"ciperAgent.completionModel": "qwen2.5-coder:1.5b"`

**Agent loops forever or hits iteration limit**
- Increase `ciperAgent.maxAgentIterations` (default 20)
- Use a more capable model — smaller models struggle with strict JSON output format
- Check the chat panel for parse error messages (the agent retries up to 3 times on bad JSON)

**File edits fail to apply**
- The agent uses unified diff format — some models produce malformed diffs
- Try rephrasing: "rewrite the entire function X" (triggers `write_file`) rather than "add a line to X" (triggers `edit_file`)

---

## Security

- **File writes always require approval** (unless you disable `requireApprovalForEdits`)
- **Dangerous shell commands are blocked**: `rm -rf`, `sudo`, `curl | bash`, `wget | sh`, `dd if=`, fork bombs, etc.
- **Path traversal is prevented**: the agent cannot read or write files outside the open workspace folder
- All inference is local — no API keys, no telemetry, no network calls except to `localhost:11434`
