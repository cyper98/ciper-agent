# Kế Hoạch Xây Dựng Local AI Agent với Ollama

## 📋 Mục Tiêu Dự Án
Xây dựng một agent AI local tương tự GitHub Copilot/Claude Code Chat với khả năng:
- Phân tích và tạo kế hoạch (planning)
- Gợi ý và sửa code
- Chuyển đổi giữa các model Ollama
- Tích hợp với IDE/Editor
- Quản lý context dài
- Chat tương tác

---

## 🏗 Kiến Trúc Tổng Thể

```
┌──────────────────────────────────────────────────────┐
│    VS Code Extension (TypeScript/React)             │
│  - Side Panel UI                                    │
│  - Inline Code Actions                             │
│  - Model Switcher                                  │
│  - Settings Panel                                  │
│  - Command Palette Integration                     │
└──────────────────┬───────────────────────────────────┘
                   │ WebSocket/HTTP
┌──────────────────▼───────────────────────────────────┐
│      FastAPI Backend (Python)                       │
│  - Request Processing                              │
│  - Agent Orchestration                             │
│  - Context Management                              │
│  - Streaming Response Handler                      │
└──────────────────┬───────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────┐
│      Feature Agents                                 │
│  - Planning Engine                                 │
│  - Code Analysis & Fixing                          │
│  - Model Manager                                   │
│  - Chat Engine                                     │
└──────────────────┬───────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────┐
│      Ollama Integration                             │
│  - Ollama Client                                   │
│  - Prompt Engineering                              │
│  - Streaming Response Parser                       │
└──────────────────┬───────────────────────────────────┘
                   │
┌──────────────────▼───────────────────────────────────┐
│    Ollama Local LLM Server                          │
│  - Codellama / Mistral / Llama2 / etc              │
└──────────────────────────────────────────────────────┘
```

---

## 📦 Tech Stack

### 🖥 VS Code Extension Frontend
```
TypeScript + React + VS Code API

Key Libraries:
├── @types/vscode - VS Code API types
├── react - UI components
├── react-markdown - Markdown rendering
├── highlight.js - Code highlighting
├── webfont - Icon library
│
Extension Features:
├── Side Panel (WebView React)
├── Command Palette Integration
├── Inline Code Lenses
├── Status Bar Integration
├── File Explorer Context Menu
├── Settings UI
└── Keybindings
```

### 🐍 Backend (Python 3.10+)
```
FastAPI + Uvicorn

Core Libraries:
├── fastapi - Web framework
├── uvicorn - ASGI server
├── requests/httpx - HTTP client
├── pydantic - Data validation
├── python-dotenv - Config management
├── websockets - Real-time updates
├── aiofiles - Async file I/O
│
Optional Tools:
├── langchain - LLM abstraction
├── sympy - Math operations
├── ast - Code parsing
└── black - Code formatting
```

### 💾 Storage & Context
```
Local SQLite Database:
├── Conversation history
├── Model configurations
├── User preferences
├── Code snippets cache
├── Session state
└── Analytics data

VS Code Global State:
├── Last used model
├── API endpoint config
├── UI preferences
└── Extensions settings
```

### 🔌 Communication
```
Extension ↔ Backend:
├── HTTP/WebSocket (via localhost:8000)
├── JSON-RPC protocol
├── Text-based streaming
└── Real-time event updates
```

---

## 🎯 Core Features Breakdown

### 1. **Model Manager** ⚙️
```yaml
Features:
  - List available models từ Ollama
  - Pull models automatically
  - Switch models seamlessly
  - Config model parameters (temperature, top_p, etc)
  - Health check & status monitoring
```

**Workflow**:
```
User Input → Detect model switch command
          → Call Ollama API: /api/tags
          → List available models
          → Update config & validate
          → Return confirmation
```

### 2. **Planning Engine** 📋
```yaml
Features:
  - Parse user request
  - Break down into steps
  - Ask clarifying questions
  - Visualize workflow
  - Generate checklist
```

**Prompt Template**:
```
You are an expert software architect. User request:
[USER REQUEST]

Create a detailed plan with:
1. Analysis of the problem
2. Step-by-step implementation plan
3. Key decisions and trade-offs
4. Potential risks
5. Estimated effort

Format as structured markdown.
```

### 3. **Code Analysis & Fixing** 🔧
```yaml
Features:
  - Analyze code for bugs/issues
  - Suggest improvements
  - Auto-fix with explanation
  - Refactoring recommendations
  - Performance analysis
  - Security review
```

**Workflow**:
```
User submits code
    ↓
Extract language detection
    ↓
Create context window (file + surrounding)
    ↓
Send to Ollama with specialized prompt
    ↓
Parse response (suggestions + fixes)
    ↓
Display with diff/highlight
```

### 4. **Context Management** 💾
```yaml
Features:
  - Maintain conversation history
  - File context awareness
  - Project structure tracking
  - Conversation summarization
  - Long context handling (2K → 8K tokens)
```

**Context Layers**:
- **Session Context**: Current conversation
- **File Context**: Currently edited file + related
- **Project Context**: Project structure, dependencies
- **System Context**: OS, language version, env

### 5. **Code Execution & Testing** ▶️
```yaml
Features:
  - Sandbox code execution
  - Test generation
  - Output validation
  - Performance metrics
```

### 6. **Chat Interface** 💬
```yaml
Features:
  - Multi-turn conversation
  - Streaming responses
  - Code block highlighting
  - Copy-to-clipboard buttons
  - Conversation export
```

---

## � VS Code Extension Development Guide

### Extension Commands
```typescript
// Command Palette Commands
ciper.chat              // Open chat panel
ciper.plan              // Generate plan for selection
ciper.analyzeCode       // Analyze selected code
ciper.switchModel       // Quick model switcher
ciper.clearHistory      // Clear chat history
ciper.settings          // Open settings
ciper.viewModels        // List available models

// Context Menu Commands
ciper.analyzeSelection  // Right-click on code
ciper.explainCode       // Explain selected code
ciper.testGenerate      // Generate tests
```

### Webview Communication Pattern
```typescript
// Extension → Webview
panel.webview.postMessage({
  type: 'MODEL_CHANGED',
  model: 'mistral'
});

// Webview → Extension (from React)
window.addEventListener('message', event => {
  const message = event.data;
  if (message.type === 'CHAT_MESSAGE') {
    // Send to backend
  }
});

// Backend Response → Extension → Webview
fetch('http://localhost:8000/api/chat')
  .then(response => response.body.getReader())
  .then(reader => {
    // Stream to webview
    panel.webview.postMessage({
      type: 'STREAM_CHUNK',
      data: chunk
    });
  });
```

### File Context Integration
```typescript
// Auto-extract context from active editor
const editor = vscode.window.activeTextEditor;
if (editor) {
  const context = {
    language: editor.document.languageId,
    fileName: editor.document.fileName,
    selectedText: editor.document.getText(editor.selection),
    fullContent: editor.document.getText(),
    cursorPosition: editor.selection.active,
    projectRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  };
  // Send to backend for context-aware responses
}
```

### Status Bar Integration
```typescript
const statusBar = vscode.window.createStatusBarItem(
  vscode.StatusBarAlignment.Right,
  100
);
statusBar.command = 'ciper.switchModel';
statusBar.text = `$(hubot) ${currentModel}`;
statusBar.tooltip = 'Click to switch model';
statusBar.show();
```

### Settings Schema
```json
{
  "ciper.backend.url": {
    "type": "string",
    "default": "http://localhost:8000",
    "description": "Backend API URL"
  },
  "ciper.defaultModel": {
    "type": "string",
    "default": "mistral",
    "description": "Default model to use"
  },
  "ciper.temperature": {
    "type": "number",
    "default": 0.7,
    "minimum": 0,
    "maximum": 1,
    "description": "Temperature for model responses"
  },
  "ciper.enableInlineHints": {
    "type": "boolean",
    "default": true,
    "description": "Show inline code analysis hints"
  }
}
```



### Phase 1: Foundation (Week 1-2)
```
✅ Setup project structure
✅ Ollama integration layer
✅ Basic API (health check, list models)
✅ Simple CLI tool for testing
✅ Environment configuration
```

**Deliverables**:
- `/backend` - FastAPI server
- `/cli` - Command line tool
- `/config` - Model configuration files
- `.env.example` - Environment template
- `requirements.txt` - Dependencies

**Milestones**:
- Day 1-2: Project setup + Ollama client
- Day 3-4: API endpoints (models, health)
- Day 5-6: CLI tool + testing
- Day 7: Documentation

---

### Phase 2: Core Features (Week 3-4)
```
✅ Model Manager implementation
✅ Planning Engine with prompt engineering
✅ Code Analysis module
✅ Chat interface (CLI)
✅ Context management system
```

**Deliverables**:
- `/backend/agents/` - Agent modules
- `/backend/prompts/` - Prompt templates
- `/backend/context/` - Context handlers
- Test suite

**Milestones**:
- Day 8-10: Model manager
- Day 11-12: Planning engine
- Day 13-14: Code analysis
- Day 15: Integration testing

---

### Phase 3: VS Code Extension Development (Week 5-6)
```
🎯 This is the PRIMARY focus

Core Features:
✅ Side Panel - Main chat interface
✅ Command Palette - Quick access to agents
✅ Inline Code Lenses - Code analysis hints
✅ Status Bar - Model switcher + status
✅ File Context - Auto-detect current file
✅ Streaming Chat - Real-time responses
✅ Settings Panel - Configure models/API
```

**Deliverables**:
- `/extension` - Complete VS Code Extension
- TypeScript + React components
- Webview UI
- Command handlers
- File system integration
- Settings schema
- Package & publish to marketplace

**VS Code Extension Specifics**:
```yaml
Components:
  - activation.ts: Extension entry point
  - extension.ts: Main logic & commands
  - webview/:
    - chat-panel.tsx: Main chat UI
    - model-switcher.tsx: Model selection
    - code-viewer.tsx: Code display
    - settings-panel.tsx: Configuration
  - providers/:
    - code-lens-provider.ts: Inline hints
    - completion-provider.ts: Auto-complete
    - hover-provider.ts: Hover info

Features:
  - Lazy load Webview (performance)
  - Streaming responses (SSE)
  - Context from active editor
  - Multi-tab conversation support
  - Export chat history
  - Keyboard shortcuts
```

**Milestones**:
- Day 15-16: Extension scaffolding + hello world
- Day 17-18: Webview chat UI component
- Day 19-20: Command palette integration
- Day 21: Status bar + model switcher

---

### Phase 4: Advanced Features (Week 7-8)
```
✅ Conversation history
✅ Code snippet library
✅ Multi-file context
✅ Performance optimization
✅ Error handling & recovery
```

**Deliverables**:
- Vector database integration
- Caching layer
- Error recovery
- Rate limiting
- Comprehensive logging

---

### Phase 5: Polish & Deployment (Week 9-10)
```
✅ Performance optimization
✅ Security hardening
✅ Documentation
✅ Package creation
✅ Release pipeline
```

---

## 🔌 Ollama Integration Details

### 1. **API Endpoints Used**
```bash
# List models
GET http://localhost:11434/api/tags

# Generate response
POST http://localhost:11434/api/generate
{
  "model": "codellama",
  "prompt": "...",
  "stream": true,
  "options": {
    "temperature": 0.7,
    "top_p": 0.9
  }
}

# Pull model
POST http://localhost:11434/api/pull
{"name": "mistral"}

# Health check
HEAD http://localhost:11434/
```

### 2. **Model Selection Strategy**
```
┌─────────────────────────────────────────┐
│ For Different Tasks:                    │
├─────────────────────────────────────────┤
│ Planning    → Mistral 7B / Llama2 13B  │
│ Code Fix    → Codellama 34B            │
│ General     → Mistral / Llama2 13B     │
│ Fast        → Neural-chat / Orca       │
│ Reasoning   → Llama2 70B (if possible) │
└─────────────────────────────────────────┘
```

### 3. **Configuration**
```yaml
models:
  default: mistral
  available:
    - name: codellama
      description: "Specialized for code"
      optimal_temp: 0.3
      context_window: 4096
      
    - name: mistral
      description: "General purpose"
      optimal_temp: 0.7
      context_window: 8192
      
    - name: llama2
      description: "Reasoning & analysis"
      optimal_temp: 0.5
      context_window: 4096
```

---

## 📂 Project Structure (Extension-Focused)

```
ciper-agent/
│
├── backend/
│   ├── main.py                          # FastAPI server
│   ├── agents/
│   │   ├── planner.py                  # Planning engine
│   │   ├── code_analyzer.py            # Code analysis
│   │   ├── model_manager.py            # Model management
│   │   └── chat_engine.py              # Chat logic
│   ├── prompts/
│   │   ├── system_prompts.py           # System prompts
│   │   ├── code_prompts.py             # Code analysis prompts
│   │   └── planning_prompts.py         # Planning prompts
│   ├── context/
│   │   ├── context_manager.py          # Context handling
│   │   ├── memory.py                   # Conversation storage
│   │   └── file_context.py             # File awareness
│   ├── llm/
│   │   └── ollama_client.py            # Ollama API wrapper
│   ├── utils/
│   │   ├── config.py                   # Configuration management
│   │   ├── logger.py                   # Logging setup
│   │   └── validators.py               # Input validation
│   ├── tests/
│   │   ├── test_ollama.py
│   │   ├── test_agents.py
│   │   └── test_api.py
│   ├── requirements.txt
│   └── .env.example
│
├── extension/                           # 🎯 MAIN FOCUS
│   ├── src/
│   │   ├── extension.ts                 # Extension entry point
│   │   ├── commands/
│   │   │   ├── index.ts                 # Command registration
│   │   │   ├── chat.ts                  # Chat command
│   │   │   ├── plan.ts                  # Plan command
│   │   │   ├── analyze.ts               # Code analysis command
│   │   │   └── models.ts                # Model management command
│   │   ├── providers/
│   │   │   ├── code-lens-provider.ts    # Inline code hints
│   │   │   ├── hover-provider.ts        # Hover information
│   │   │   └── completion-provider.ts   # Auto-complete (optional)
│   │   ├── views/
│   │   │   ├── chat-panel.tsx           # Main chat UI
│   │   │   ├── model-switcher.tsx       # Model selector
│   │   │   ├── code-viewer.tsx          # Code display with highlight
│   │   │   ├── settings-panel.tsx       # Settings UI
│   │   │   └── styles/
│   │   │       ├── chat.css
│   │   │       ├── editor.css
│   │   │       └── theme.css
│   │   ├── utils/
│   │   │   ├── api-client.ts            # Backend communication
│   │   │   ├── storage.ts               # VS Code global state
│   │   │   ├── stream-handler.ts        # Handle streaming
│   │   │   └── context-extractor.ts     # Extract editor context
│   │   ├── types/
│   │   │   └── index.ts                 # TypeScript interfaces
│   │   └── webview/
│   │       ├── index.html               # Webview HTML
│   │       ├── App.tsx                  # React root
│   │       └── index.tsx                # React entry
│   ├── media/
│   │   ├── icon.png                     # Extension icon
│   │   └── screenshot.png               # Marketplace screenshot
│   ├── package.json
│   ├── tsconfig.json
│   ├── webpack.config.js
│   ├── .vscodeignore
│   ├── CHANGELOG.md
│   └── vsc-extension-quickstart.md
│
├── docs/
│   ├── ARCHITECTURE.md                  # System design
│   ├── EXTENSION-SETUP.md               # Extension dev setup
│   ├── BACKEND-API.md                   # API documentation
│   ├── EXTENSION-API.md                 # VS Code API usage
│   ├── USAGE.md                         # User guide
│   └── DEPLOYMENT.md                    # Publish to marketplace
│
├── .github/
│   └── workflows/
│       ├── test-backend.yml
│       └── release-extension.yml
│
├── PLAN.md                              # This file
├── README.md                            # Quick start
├── setup.sh                             # Setup script
└── requirements.txt                     # Python deps
```

---

## 🚀 Quick Start Implementation

### Backend Setup (First)

#### Step 1: Environment Setup
```bash
# Clone/init project
mkdir ciper-agent && cd ciper-agent
git init

# Backend directory
mkdir backend && cd backend

# Create virtual env
python -m venv venv
source venv/bin/activate

# Install dependencies
pip install fastapi uvicorn requests pydantic python-dotenv pytest websockets aiofiles

# Create .env
cat > .env << EOF
OLLAMA_API_URL=http://localhost:11434
DEFAULT_MODEL=mistral
LOG_LEVEL=INFO
BACKEND_PORT=8000
EOF
```

#### Step 2: Ollama Client
```python
# backend/llm/ollama_client.py
import requests
import json
from typing import Optional, Iterator

class OllamaClient:
    def __init__(self, api_url: str = "http://localhost:11434"):
        self.api_url = api_url
    
    def list_models(self) -> list:
        """Get available models"""
        try:
            response = requests.get(f"{self.api_url}/api/tags")
            return response.json().get("models", [])
        except:
            return []
    
    def generate(
        self,
        model: str,
        prompt: str,
        stream: bool = True,
        temperature: float = 0.7
    ) -> Iterator[str]:
        """Generate response with streaming"""
        payload = {
            "model": model,
            "prompt": prompt,
            "stream": stream,
            "options": {"temperature": temperature}
        }
        
        response = requests.post(
            f"{self.api_url}/api/generate",
            json=payload,
            stream=stream
        )
        
        for line in response.iter_lines():
            if line:
                yield json.loads(line).get("response", "")
    
    def health_check(self) -> bool:
        """Check if Ollama is running"""
        try:
            requests.head(f"{self.api_url}/", timeout=2)
            return True
        except:
            return False
```

#### Step 3: FastAPI Server
```python
# backend/main.py
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import asyncio
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Ciper Agent Backend")

# CORS for Extension
app.add_middleware(
    CORSMiddleware,
    allow_origins=["vscode-webview://"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
async def health():
    from backend.llm.ollama_client import OllamaClient
    client = OllamaClient()
    return {
        "status": "ok",
        "ollama": client.health_check()
    }

@app.get("/api/models")
async def get_models():
    from backend.llm.ollama_client import OllamaClient
    client = OllamaClient()
    models = client.list_models()
    return {"models": models}

@app.post("/api/chat")
async def chat_endpoint(request: dict):
    """Chat endpoint with streaming"""
    model = request.get("model", os.getenv("DEFAULT_MODEL"))
    message = request.get("message")
    temperature = request.get("temperature", 0.7)
    
    from backend.llm.ollama_client import OllamaClient
    client = OllamaClient()
    
    def generate():
        for chunk in client.generate(model, message, temperature=temperature):
            yield chunk
    
    return StreamingResponse(generate(), media_type="text/plain")

@app.post("/api/plan")
async def create_plan(request: dict):
    """Generate plan for request"""
    from backend.agents.planner import PlanningEngine
    engine = PlanningEngine()
    plan = engine.generate_plan(request.get("input"))
    return {"plan": plan}

@app.post("/api/analyze-code")
async def analyze_code(request: dict):
    """Analyze code"""
    from backend.agents.code_analyzer import CodeAnalyzer
    analyzer = CodeAnalyzer()
    analysis = analyzer.analyze(
        request.get("code"),
        request.get("language", "python")
    )
    return analysis

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("BACKEND_PORT", 8000))
    uvicorn.run(app, host="127.0.0.1", port=port)
```

#### Step 4: Run Backend
```bash
# In backend directory with venv activated
python main.py
# Server runs on http://localhost:8000
```

---

### VS Code Extension Setup (After Backend)

#### Step 1: Generate Extension Scaffold
```bash
# In project root
npm install -g @vscode/generator-code
yo code

# Choose options:
# - TypeScript
# - Extension name: ciper-agent
# - Use webview: Yes
```

#### Step 2: Extension Structure
```bash
cd extension
npm install
# Additional packages:
npm install react highlight.js markdown-it
npm install -D @types/react ts-loader webpack webpack-cli
```

#### Step 3: Extension Entry Point
```typescript
// extension/src/extension.ts
import * as vscode from 'vscode';
import { ChatPanel } from './views/chat-panel';

let chatPanel: ChatPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
    // Register chat command
    let disposable = vscode.commands.registerCommand('ciper.chat', () => {
        if (ChatPanel.currentPanel) {
            ChatPanel.currentPanel.reveal(vscode.ViewColumn.Beside);
        } else {
            ChatPanel.createOrShow(context.extensionUri, context);
        }
    });

    context.subscriptions.push(disposable);

    // Status bar
    const statusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBar.command = 'ciper.chat';
    statusBar.text = '$(hubot) Ciper';
    statusBar.show();
    context.subscriptions.push(statusBar);
}

export function deactivate() {}
```

#### Step 4: Webview Chat Panel
```typescript
// extension/src/views/chat-panel.ts
import * as vscode from 'vscode';
import * as path from 'path';

export class ChatPanel {
    public static currentPanel: ChatPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;

    public static createOrShow(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        const column = vscode.window.activeTextEditor
            ? vscode.ViewColumn.Beside
            : vscode.ViewColumn.One;

        if (ChatPanel.currentPanel) {
            ChatPanel.currentPanel.panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'ciperChat',
            'Ciper Agent',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [path.join(extensionUri.fsPath, 'media')]
            }
        );

        ChatPanel.currentPanel = new ChatPanel(panel, extensionUri, context);
        panel.onDidDispose(() => ChatPanel.currentPanel = undefined);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.panel.webview.html = this.getWebviewContent();

        // Handle messages from webview
        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.type) {
                    case 'CHAT_MESSAGE':
                        await this.handleChatMessage(message.data);
                        break;
                    case 'SWITCH_MODEL':
                        await this.handleSwitchModel(message.data);
                        break;
                }
            },
            undefined,
            context.subscriptions
        );
    }

    private async handleChatMessage(message: string) {
        try {
            const response = await fetch('http://localhost:8000/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message,
                    model: vscode.workspace.getConfiguration('ciper').get('defaultModel')
                })
            });

            if (response.body) {
                const reader = response.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    const chunk = new TextDecoder().decode(value);
                    this.panel.webview.postMessage({
                        type: 'STREAM_CHUNK',
                        data: chunk
                    });
                }
            }
        } catch (error) {
            console.error('Chat error:', error);
        }
    }

    private async handleSwitchModel(model: string) {
        const config = vscode.workspace.getConfiguration('ciper');
        await config.update('defaultModel', model, vscode.ConfigurationTarget.Global);
    }

    private getWebviewContent(): string {
        // Return HTML for webview
        return `<!DOCTYPE html>
        <html>
        <head>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    padding: 10px;
                }
                #chat-container {
                    display: flex;
                    flex-direction: column;
                    height: 100vh;
                }
            </style>
        </head>
        <body>
            <div id="chat-container">
                <div id="messages"></div>
                <input id="input" type="text" placeholder="Ask something..." />
            </div>
            <script src="${this.getScriptUri('chat.js')}"></script>
        </body>
        </html>`;
    }

    private getScriptUri(scriptName: string): vscode.Uri {
        return this.panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'media', scriptName)
        );
    }

    public reveal(viewColumn?: vscode.ViewColumn) {
        this.panel.reveal(viewColumn);
    }
}
```

#### Step 5: Package.json Configuration
```json
{
  "name": "ciper-agent",
  "displayName": "Ciper Agent",
  "description": "Local AI Agent powered by Ollama",
  "version": "0.1.0",
  "engines": {
    "vscode": "^1.84.0"
  },
  "categories": ["AI", "Programming Languages"],
  "activationEvents": [
    "onCommand:ciper.chat"
  ],
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "ciper.chat",
        "title": "Open Ciper Chat",
        "category": "Ciper"
      },
      {
        "command": "ciper.plan",
        "title": "Generate Plan",
        "category": "Ciper"
      },
      {
        "command": "ciper.analyzeCode",
        "title": "Analyze Code",
        "category": "Ciper"
      }
    ],
    "configuration": {
      "title": "Ciper Agent",
      "properties": {
        "ciper.backend.url": {
          "type": "string",
          "default": "http://localhost:8000",
          "description": "Backend API URL"
        },
        "ciper.defaultModel": {
          "type": "string",
          "default": "mistral",
          "description": "Default model"
        }
      }
    }
  },
  "devDependencies": {
    "@types/vscode": "^1.84.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "webpack": "^5.0.0",
    "webpack-cli": "^5.0.0",
    "ts-loader": "^9.0.0"
  }
}
```

#### Step 6: Build & Run Extension
```bash
# In extension directory
npm run watch  # Watch mode for development

# In VS Code:
# Press F5 to launch Extension Development Host
```

---

## 🧪 Testing Strategy

### Unit Tests
```python
# backend/tests/test_ollama.py
import pytest
from backend.llm.ollama_client import OllamaClient

def test_list_models():
    client = OllamaClient()
    models = client.list_models()
    assert isinstance(models, list)

def test_health_check():
    client = OllamaClient()
    assert client.health_check() == True

def test_generate_response():
    client = OllamaClient()
    response = client.generate("mistral", "Hello")
    assert response is not None
```

### Integration Tests
- Test full conversation flow
- Test model switching
- Test context persistence
- Test error handling

### Performance Tests
- Response time benchmarks
- Memory usage monitoring
- Concurrent request handling

---

## 📊 Key Metrics & Monitoring

```yaml
Metrics to Track:
  - Response time (msec)
  - Token usage (per model)
  - Memory consumption (MB)
  - Model switch success rate
  - Error rate (%)
  - User satisfaction (ratings)
  
Logging:
  - All API calls
  - Model performance
  - Error stack traces
  - User interactions (anonymized)
```

---

## 🔒 Security Considerations

1. **Input Validation**: Sanitize all user inputs
2. **Rate Limiting**: Prevent abuse
3. **CORS**: Configure properly for deployment
4. **Secrets Management**: Never commit `.env` files
5. **Sandbox Execution**: If running user code
6. **Audit Logging**: Track all operations

---

## 🎓 Learning Resources

- [Ollama Documentation](https://ollama.ai)
- [FastAPI Docs](https://fastapi.tiangolo.com/)
- [LangChain](https://python.langchain.com/)
- [VS Code Extension API](https://code.visualstudio.com/api)
- [Prompt Engineering Guide](https://github.com/dair-ai/Prompt-Engineering-Guide)

---

## 📅 Timeline Overview

```
Phase 1 (Week 1-2):     Foundation & Backend Setup
    └─ Ollama integration, FastAPI server, Core agents

Phase 2 (Week 3-4):     Core Agents Development
    └─ Planning, Code analysis, Model manager, Chat

Phase 3 (Week 5-6):     🎯 VS Code Extension
    └─ Webview, Commands, Status bar, File context

Phase 4 (Week 7-8):     Advanced Features
    └─ Streaming, Multi-turn, History, Code lens

Phase 5 (Week 9-10):    Polish & Marketplace Release
    └─ Testing, Docs, Marketplace publish

Timeline: ~10 weeks for MVP → 12-14 weeks for production-ready
```

### Critical Path (Shortest to MVP with Extension):
```
Week 1: Backend repo + Ollama client ✓
Week 2: FastAPI server + basic agents ✓
Week 3: Extension scaffolding + webview
Week 4: Chat UI + command integration
Week 5: Streaming + model switcher
Week 6: Settings + Extension publish
```

---

## 🚀 Publishing to VS Code Marketplace

### Prerequisites
```bash
# Install VSCE (VS Code Extension publishing tool)
npm install -g @vscode/vsce

# Create personal access token on GitHub/Microsoft account
# Store in safe location
```

### Pre-Publish Checklist
- [ ] Version bump in package.json
- [ ] CHANGELOG.md updated
- [ ] README.md complete with screenshots
- [ ] Extension icon (128x128 PNG)
- [ ] Marketplace screenshots created
- [ ] All dependencies documented
- [ ] Tests passing (npm test)
- [ ] No ES6 syntax errors
- [ ] LICENSE file included

### Publishing Steps
```bash
# In extension directory
npm run compile          # Build TypeScript
npm test               # Run tests
vsce publish          # Publish to marketplace
# or vsce package      # Create .vsix file to publish manually
```

### Post-Publish
- [ ] Monitor marketplace ratings
- [ ] Setup automated CI/CD for releases
- [ ] Create update notifications
- [ ] Track extension metrics
- [ ] Gather user feedback

---

## ✅ Success Criteria (Extension-Focused)

### MVP (Minimum Viable Product)
- [ ] Extension installs from marketplace
- [ ] Backend connects successfully
- [ ] Chat works with streaming responses
- [ ] Model switcher functional
- [ ] Settings panel configurable
- [ ] No critical errors in logs

### Quality Gates
- [ ] Response time <2s for simple queries
- [ ] Handles 3+ concurrent chat sessions
- [ ] Extension memory <100MB idle
- [ ] Zero crashes on typical workflows
- [ ] Code coverage >70%

### Feature Completeness
- [ ] All core commands working
- [ ] File context extraction accurate
- [ ] Conversation history persists
- [ ] Error messages user-friendly
- [ ] Dark mode support

### Extension Metrics
- [ ] First 100 installs within 2 weeks
- [ ] Rating >4.0/5.0 stars
- [ ] <5% uninstall rate
- [ ] Active users trending up
- [ ] Community contributions flowing

---

## 🔗 Next Steps (Extension-Focused Path)

### Immediate (Today)
1. ✅ Review this plan
2. ✅ Ensure Ollama is running locally
3. Setup backend project structure
4. Create Python virtual environment

### Week 1 (Foundation)
- [ ] Backend repo initialization
- [ ] Ollama client implementation
- [ ] FastAPI server setup
- [ ] Test backend endpoints with Postman/curl
- [ ] Document API contracts

### Week 2 (Core Agents)
- [ ] Planning engine
- [ ] Code analyzer agent
- [ ] Chat engine
- [ ] Model manager
- [ ] Backend testing

### Week 3-4 (Extension Development) 🎯
- [ ] Extension scaffolding
- [ ] Webview chat UI
- [ ] Command palette integration
- [ ] Model switcher in status bar
- [ ] File context extraction

### Weeks 5-6 (Polish Extension)
- [ ] Streaming responses
- [ ] Code syntax highlighting
- [ ] Settings configuration
- [ ] Keyboard shortcuts
- [ ] Icon & branding

### Week 7+ (Publish & Enhance)
- [ ] Marketplace testing
- [ ] Publish to VS Code Marketplace
- [ ] Analytics setup
- [ ] Advanced features (code lens, hover info)
- [ ] Continuous deployment

---

## 📞 Key Decisions

### Extension-Specific Questions
- [ ] Single window (side panel) or multi-window chat?
- [ ] Real-time streaming vs buffered responses?
- [ ] Should chat history persist across VS Code restarts?
- [ ] Keyboard shortcuts priority (e.g., Cmd+Shift+C for chat)?
- [ ] Include inline code lens for analysis hints?
- [ ] Export conversation format (Markdown, PDF, HTML)?
- [ ] Support collaborative editing context?

### Backend Strategy
- [ ] Which model to prioritize for code tasks?
- [ ] Local database (SQLite) or in-memory cache?
- [ ] Maximum context window size?
- [ ] Timeout for long operations?
- [ ] Error recovery strategy?

### Marketplace Readiness
- [ ] Target audience (individual devs vs teams)?
- [ ] Pricing model (free vs freemium)?
- [ ] Privacy - data sent to backend?
- [ ] Support channel (GitHub issues, Discord)?
- [ ] Update cadence?

---

**Created**: 2026-04-09  
**Status**: DRAFT - Ready for Discussion  
**Last Updated**: Latest

