# Ciper Agent

A VSCode extension that replicates GitHub Copilot Agent behavior using local LLMs via [Ollama](https://ollama.com). Fully private — no data leaves your machine.

**Key Features:**
- 🤖 **Agent Mode** — Autonomous coding assistant that reads files, edits code, runs commands
- 💬 **Chat Mode** — Conversational Q&A about your codebase
- ✨ **Inline Completions** — Ghost text suggestions as you type
- 🔒 **Fully Local** — All inference runs on your machine via Ollama
- 🔍 **Deep Code Analysis** — Traces through nested service/repository chains

---

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Features](#features)
- [Configuration](#configuration)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Troubleshooting](#troubleshooting)
- [Security](#security)

---

## Requirements

### 1. Ollama

Install Ollama from [ollama.com](https://ollama.com) or via terminal:

```bash
# macOS/Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows - Download from https://ollama.com/download
```

**Important:** Ollama must be running for Ciper Agent to work. It runs on `http://localhost:11434` by default.

```bash
# Start Ollama (usually runs automatically after install)
ollama serve

# Verify it's running
curl http://localhost:11434/api/tags
```

### 2. Pull a Model

```bash
# Recommended for coding tasks
ollama pull qwen2.5-coder:7b

# For more complex tasks (needs more VRAM)
ollama pull qwen2.5-coder:14b

# Smaller models for inline completions only
ollama pull qwen2.5-coder:1.5b
```

### 3. VSCode

VSCode 1.90 or later. [Download here](https://code.visualstudio.com/)

### 4. Node.js

Node.js v18+ for building the extension. [Download here](https://nodejs.org/)

---

## Installation

### Option 1: Development (Recommended for Testing)

```bash
# 1. Clone the repository
git clone <repo-url>
cd ciper-agent

# 2. Install dependencies
npm install

# 3. Build the extension
npm run build

# 4. Open in VSCode
code .

# 5. Press F5 to launch Extension Development Host
```

This opens a new VSCode window with Ciper Agent loaded. Changes to source code will rebuild automatically in watch mode.

### Option 2: Install from .vsix

```bash
# 1. Build the .vsix package
npm run package

# 2. Install it
code --install-extension backend/ciper-agent-*.vsix

# 3. Restart VSCode
```

Or in VSCode: `Extensions` panel → `⋯` menu → `Install from VSIX...`

---

## Quick Start

### Opening the Chat Panel

| Method | How |
|--------|-----|
| Click the **◈** icon | Left sidebar activity bar |
| Keyboard | `Ctrl+Alt+I` (Mac: `Cmd+Alt+I`) |
| Command Palette | `Ctrl+Shift+P` → `Ciper: Open Chat` |

### Your First Interaction

1. Open the chat panel
2. Select **Agent** mode (not Chat) for code tasks
3. Type your request, e.g.:
   - "Explain the main.go file"
   - "Find all TODO comments"
   - "Add error handling to the login function"
4. Press **Enter** to send

---

## Features

### Agent Mode vs Chat Mode

| Feature | Chat Mode | Agent Mode |
|---------|-----------|------------|
| File access | ❌ Read only | ✅ Full read/edit |
| Tool execution | ❌ None | ✅ Read, write, search, run commands |
| Use case | Q&A, explanations | Code changes, refactoring |
| Best for | Understanding code | Implementing features |

### Agent Mode Workflow

```
You: "Extract the raw SQL from GetUserById"

Agent:
1. 📖 Reads the main file → finds userService
2. 📖 Reads userService → finds UserRepository
3. 📖 Reads UserRepository → finds the SQL query
4. ✅ Outputs: `SELECT id, name, email FROM users WHERE id = ?`
```

The agent traces through nested dependencies automatically. No need to specify exact file paths.

### Inline Completions (Ghost Text)

As you type, Ciper suggests code in faded grey text:

```
function calculateTotal(items) {
  return items.reduce((sum, item) => {█
```

Press **Tab** to accept the suggestion. Completions are debounced (300ms) and timeout after 2 seconds.

### Diff Preview & Approval

When the agent wants to modify files:

1. A diff preview appears in the chat panel
2. Review the changes
3. Click **✓ Apply Changes** to confirm
4. Or **✗ Discard** to cancel

To auto-approve all changes (no preview):
```json
{
  "ciperAgent.requireApprovalForEdits": false
}
```

### Right-Click Context Menu

Select code in the editor, right-click:

- **Ask Ciper** — Send selection + your question to the agent
- **Fix with Ciper** — Ask the agent to fix issues in selection

Keyboard shortcut: `Ctrl+Shift+I`

---

## Configuration

Open VSCode settings (`Ctrl+,`) and search for **Ciper Agent**:

### Essential Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `ollamaEndpoint` | `http://localhost:11434` | Ollama API URL |
| `model` | `qwen2.5-coder:7b` | Primary model for chat & agent |
| `contextTokenBudget` | `8192` | Max tokens for workspace context |

### Agent Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `maxAgentIterations` | `20` | Max iterations before auto-stop |
| `requireApprovalForEdits` | `true` | Show diff preview before file changes |

### Completion Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `enableInlineCompletions` | `true` | Enable ghost text suggestions |
| `completionDebounceMs` | `300` | Delay before triggering completion |
| `completionModel` | *(uses main model)* | Separate model for completions |

### Recommended Model Combinations

| Use Case | Chat/Agent Model | Completion Model |
|----------|-----------------|-----------------|
| Fast dev (8GB VRAM) | `qwen2.5-coder:7b` | `qwen2.5-coder:1.5b` |
| Balanced (12GB VRAM) | `qwen2.5-coder:14b` | `qwen2.5-coder:3b` |
| Max quality (24GB VRAM) | `qwen2.5-coder:32b` | `qwen2.5-coder:7b` |

### Settings Examples

```json
{
  // Point to remote Ollama if not on localhost
  "ciperAgent.ollamaEndpoint": "http://192.168.1.100:11434",
  
  // Use a different default model
  "ciperAgent.model": "codellama:13b",
  
  // Faster completions with smaller model
  "ciperAgent.completionModel": "qwen2.5-coder:1.5b",
  
  // Allow auto-apply without preview
  "ciperAgent.requireApprovalForEdits": false,
  
  // More context for complex projects
  "ciperAgent.contextTokenBudget": 16384
}
```

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Alt+I` | Open Ciper chat panel |
| `Ctrl+Shift+I` | Ask Ciper about selection |
| `Tab` | Accept inline completion |
| `Esc` | Cancel agent running |

All shortcuts can be customized in VSCode settings: `Preferences → Keyboard Shortcuts`

---

## Troubleshooting

### "No models available"

1. Check Ollama is running:
   ```bash
   curl http://localhost:11434/api/tags
   ```

2. Pull a model:
   ```bash
   ollama pull qwen2.5-coder:7b
   ```

3. Verify the endpoint setting matches your Ollama install

### "Agent says it can't read files"

1. Make sure you have a workspace folder open (`File → Open Folder`)
2. Check the file path in the chat — relative paths are resolved from workspace root
3. For files outside workspace, use absolute paths

### "Agent makes up code / doesn't read files"

The agent should automatically read files before analyzing them. If it doesn't:

1. Use **Agent mode** (not Chat mode)
2. Be specific: "Read the userRepository.go file and extract the SQL query"
3. The agent traces nested dependencies automatically

### "File edits fail to apply"

1. The agent uses unified diff format — some models produce imperfect diffs
2. Try rephrasing: "rewrite the entire function X" instead of "add a line"
3. Check the file hasn't been modified externally

### "Inline completions not appearing"

1. Completions are debounced — pause briefly after typing
2. Check `ciperAgent.enableInlineCompletions` is `true`
3. Try a faster completion model: `"ciperAgent.completionModel": "qwen2.5-coder:1.5b"`

### "Agent loops forever"

1. Increase iteration limit: `"ciperAgent.maxAgentIterations": 50`
2. Use a more capable model
3. Break complex tasks into smaller steps
4. Check chat panel for parse error messages

### "Extension not loading"

1. Make sure you ran `npm run build` before pressing F5
2. Check Extension Development Host console: `Help → Toggle Developer Tools`
3. Try reloading: `Ctrl+Shift+P → Developer: Reload Window`

### Performance Issues

For slower models:
- Reduce context budget: `"ciperAgent.contextTokenBudget": 4096`
- Use dedicated fast model for completions
- Close other applications using GPU

---

## Security

### Built-in Protections

| Protection | How it works |
|------------|--------------|
| **File writes require approval** | Default — user must explicitly approve each file change |
| **Dangerous commands blocked** | `rm -rf`, `sudo`, `curl \| bash`, etc. are prevented |
| **Path traversal prevention** | Cannot read/write files outside workspace folder |
| **No network calls** | All inference runs locally via Ollama |

### Command Blocklist

The following patterns are blocked:
- `rm -rf` (recursive delete)
- `sudo` (privilege escalation)
- `curl | bash` / `wget | sh` (pipe to shell)
- `dd if=` (direct disk write)
- Fork bombs (`:(){:|:&};:`)

### Best Practices

1. **Review diffs before approving** — Don't auto-approve blindly
2. **Use Agent mode for changes** — Chat mode can't modify files
3. **Start with read-only queries** — "Explain X" before "Fix X"
4. **Keep Ollama updated** — `ollama update`

---

## Uninstalling

```bash
# Remove extension
code --uninstall-extension ciper-agent

# Or in VSCode: Extensions → Ciper Agent → Uninstall
```

---

## License

MIT

---

## Contributing

See [docs/](./docs/) for architecture documentation.

### Development Workflow

```bash
# Watch mode - auto-rebuild on changes
npm run watch

# Build production bundle
npm run build

# Run tests
npm test

# Package as .vsix
npm run package
```
