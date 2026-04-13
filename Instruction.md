# Ciper Agent — User Guide

## Requirements
- [Node.js](https://nodejs.org) >= 18
- [Ollama](https://ollama.com) running (`ollama serve`)
- At least 1 model pulled, for example: `ollama pull qwen2.5-coder:7b`

---

## Build

```bash
# 1. Install dependencies
npm install

# 2. Build everything (shared + frontend + backend)
npm run build

# 3. Package into a .vsix file
cd backend
npx @vscode/vsce package --no-dependencies
```

File output: `backend/ciper-agent-0.1.0.vsix`

---

## Install in VSCode

```bash
code --install-extension backend/ciper-agent-0.1.0.vsix
```

Or in VSCode: **Extensions** (`Ctrl+Shift+X`) → `...` → **Install from VSIX…** → select the file above.

---

## Usage

| Feature | How to use |
|-----------|-----------|
| Open chat | Click the **◈** icon on the Activity Bar, or `Ctrl+Alt+I` |
| Send message | Type in the chat input → Enter |
| Agent mode | Click **⚙ Agent** → enter a request → the agent automatically reads/edits files |
| Slash command | Type `/explain`, `/fix`, `/tests`, `/review`, `/docs` |
| Select model | Use the model dropdown in the bottom bar (auto-loaded from Ollama) |
| Ask Ciper | Select code → right-click → **Ask Ciper** |
| Stop agent | Click **■ Stop** or `Ctrl+Shift+I` |

### File Editing Flow (Agent mode)
1. The agent proposes changes → a **diff** appears directly in chat
2. Click **✓ Apply Changes** to apply, or **✗ Discard** to cancel

---

## Configuration (optional)

Go to **Settings** (`Ctrl+,`) → search for `ciperAgent`:

| Setting | Default | Description |
|---------|----------|-------|
| `ciperAgent.ollamaEndpoint` | `http://localhost:11434` | Ollama endpoint |
| `ciperAgent.model` | `qwen2.5-coder:7b` | Default model |
| `ciperAgent.contextTokenBudget` | `8192` | Context token limit |

---

## Development (watch mode)

```bash
# Terminal 1 — build on changes
npm run watch

# Terminal 2 — open VSCode with extension debug
code --extensionDevelopmentPath=$PWD/backend
```

Or press **F5** in VSCode to open the Extension Development Host.
