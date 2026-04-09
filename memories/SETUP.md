# VS Code Extension + Backend Setup Guide

**Duration**: 30-45 minutes for complete setup  
**Difficulty**: Beginner Friendly  
**Last Updated**: 2026-04-09

---

## Prerequisites Check

### 1. Verify Ollama is Installed and Running

```bash
# Check ollama command exists
which ollama
# Should output: /usr/local/bin/ollama (or similar)

# Check ollama server is running
curl http://localhost:11434/api/tags
# Should return JSON with available models

# If ollama is not running:
# Start background server (in separate terminal)
ollama serve
```

### 2. Verify Node.js is Installed

```bash
node --version
# Should output v14.0.0 or higher

npm --version
# Should output 6.0.0 or higher

# If not installed:
# macOS: brew install node
# or download from https://nodejs.org/
```

### 3. Verify Python is Installed

```bash
python3 --version
# Should output 3.10.0 or higher

pip3 --version
# Should output 21.0 or higher

# If not installed:
# macOS: brew install python3
# or download from https://python.org/
```

### 4. Verify VS Code is Ready

```bash
# Check code command works
which code
# Should output path to VS Code binary

# If not:
# Open VS Code
# Press Cmd+Shift+P
# Type "Shell Command: Install 'code' command"
```

---

## Step-by-Step Setup

### Backend Setup (Python/FastAPI)

#### Step 1.1: Create Project Directories

```bash
# Navigate to project directory
cd /Users/seang/Downloads/dev/ciper-agent

# Create backend directory (if not exists)
mkdir -p backend
cd backend

# Create subdirectories for organization
mkdir -p agents llm utils context tests prompts
```

#### Step 1.2: Initialize Python Virtual Environment

```bash
# Still in backend/ directory
python3 -m venv venv

# Activate virtual environment
source venv/bin/activate

# You should see (venv) prefix in shell prompt
# Verify Python path points to venv
which python
# Should output: /Users/seang/Downloads/dev/ciper-agent/backend/venv/bin/python
```

#### Step 1.3: Create requirements.txt

Create file: `backend/requirements.txt`

```
fastapi==0.104.1
uvicorn[standard]==0.24.0
requests==2.31.0
pydantic==2.5.0
python-dotenv==1.0.0
pytest==7.4.3
httpx==0.25.1
aiofiles==23.2.1
```

#### Step 1.4: Install Python Dependencies

```bash
# With venv activated
pip install -r requirements.txt

# Verify installations
pip list
# Should see fastapi, uvicorn, requests, pydantic listed
```

#### Step 1.5: Create Environment Configuration

Create file: `backend/.env`

```bash
# Ollama configuration
OLLAMA_API_URL=http://localhost:11434
DEFAULT_MODEL=mistral

# Server configuration
BACKEND_PORT=8000
HOST=127.0.0.1

# Logging
LOG_LEVEL=INFO
```

#### Step 1.6: Create .env.example (for repository)

```bash
# Copy .env as template
cp backend/.env backend/.env.example
```

#### Step 1.7: Create Basic Backend Structure

Create file: `backend/llm/ollama_client.py`

```python
"""Ollama API Client"""
import requests
import json
from typing import Iterator, Optional, List

class OllamaClient:
    def __init__(self, api_url: str = "http://localhost:11434"):
        self.api_url = api_url.rstrip('/')
    
    def health_check(self) -> bool:
        """Check if Ollama server is running"""
        try:
            response = requests.head(f"{self.api_url}/", timeout=2)
            return response.status_code == 200
        except Exception as e:
            print(f"Ollama health check failed: {e}")
            return False
    
    def list_models(self) -> List[dict]:
        """Get list of available models"""
        try:
            response = requests.get(f"{self.api_url}/api/tags", timeout=10)
            response.raise_for_status()
            data = response.json()
            return data.get("models", [])
        except Exception as e:
            print(f"Failed to list models: {e}")
            return []
    
    def generate(
        self,
        model: str,
        prompt: str,
        stream: bool = True,
        temperature: float = 0.7,
        top_p: float = 0.9
    ) -> Iterator[str]:
        """Generate text response from Ollama"""
        payload = {
            "model": model,
            "prompt": prompt,
            "stream": stream,
            "options": {
                "temperature": temperature,
                "top_p": top_p
            }
        }
        
        try:
            response = requests.post(
                f"{self.api_url}/api/generate",
                json=payload,
                stream=stream,
                timeout=120  # Long timeout for generation
            )
            response.raise_for_status()
            
            if stream:
                for line in response.iter_lines():
                    if line:
                        try:
                            data = json.loads(line)
                            if "response" in data:
                                yield data["response"]
                        except json.JSONDecodeError:
                            continue
            else:
                data = response.json()
                yield data.get("response", "")
                
        except Exception as e:
            yield f"Error: {str(e)}"
```

Create file: `backend/main.py`

```python
"""FastAPI Backend Server for Ciper Agent"""
import os
import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv

from llm.ollama_client import OllamaClient

# Load .env configuration
load_dotenv()

app = FastAPI(
    title="Ciper Agent Backend",
    description="Local AI Agent Backend",
    version="0.1.0"
)

# Setup CORS to allow VS Code Extension
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for now
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Ollama client
ollama_url = os.getenv("OLLAMA_API_URL", "http://localhost:11434")
ollama_client = OllamaClient(ollama_url)

# Request/Response models
class ChatRequest(BaseModel):
    model: str
    message: str
    temperature: float = 0.7
    top_p: float = 0.9

class PlanRequest(BaseModel):
    input: str
    model: str

class CodeAnalysisRequest(BaseModel):
    code: str
    language: str = "python"
    model: str

# Routes
@app.get("/api/health")
async def health():
    """Health check endpoint"""
    ollama_healthy = ollama_client.health_check()
    return {
        "status": "ok",
        "backend": "running",
        "ollama": ollama_healthy,
        "ollama_url": ollama_url
    }

@app.get("/api/models")
async def list_models():
    """List available Ollama models"""
    models = ollama_client.list_models()
    return {
        "models": models,
        "count": len(models)
    }

@app.post("/api/chat")
async def chat(request: ChatRequest):
    """Chat endpoint with streaming response"""
    
    if not request.model:
        raise HTTPException(status_code=400, detail="Model not specified")
    
    if not request.message:
        raise HTTPException(status_code=400, detail="Message is empty")
    
    def generate():
        for chunk in ollama_client.generate(
            model=request.model,
            prompt=request.message,
            stream=True,
            temperature=request.temperature,
            top_p=request.top_p
        ):
            yield chunk
    
    return StreamingResponse(generate(), media_type="text/event-stream")

@app.post("/api/plan")
async def create_plan(request: PlanRequest):
    """Generate a plan for the given request"""
    
    prompt = f"""You are an expert software architect. Analyze this request and create a detailed plan:

Request: {request.input}

Provide:
1. Analysis of the problem
2. Step-by-step implementation plan
3. Key decisions and trade-offs
4. Potential risks
5. Estimated effort

Format as structured markdown with clear sections."""

    response_text = ""
    for chunk in ollama_client.generate(
        model=request.model,
        prompt=prompt,
        stream=False,
        temperature=0.5
    ):
        response_text += chunk
    
    return {
        "plan": response_text
    }

@app.post("/api/analyze-code")
async def analyze_code(request: CodeAnalysisRequest):
    """Analyze provided code for issues and suggestions"""
    
    prompt = f"""You are an expert code reviewer. Analyze this {request.language} code:

```{request.language}
{request.code}
```

Provide:
1. Issues found (bugs, security concerns, performance)
2. Code quality suggestions
3. Best practices recommendations
4. Improved version (if applicable)

Be concise and actionable."""

    response_text = ""
    for chunk in ollama_client.generate(
        model=request.model,
        prompt=prompt,
        stream=False,
        temperature=0.3
    ):
        response_text += chunk
    
    return {
        "analysis": response_text
    }

@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "app": "Ciper Agent Backend",
        "version": "0.1.0",
        "endpoints": [
            "/api/health",
            "/api/models",
            "/api/chat",
            "/api/plan",
            "/api/analyze-code"
        ]
    }

# Error handler
@app.get("/api/models")
async def get_models_with_error_handling():
    """Get models with better error handling"""
    try:
        models = ollama_client.list_models()
        if not models:
            raise HTTPException(
                status_code=503,
                detail="No models available. Make sure Ollama is running and models are installed."
            )
        return {"models": models}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch models: {str(e)}"
        )

if __name__ == "__main__":
    import uvicorn
    
    port = int(os.getenv("BACKEND_PORT", 8000))
    
    print(f"🚀 Starting Ciper Agent Backend")
    print(f"📡 Ollama URL: {ollama_url}")
    print(f"🌐 Server: http://127.0.0.1:{port}")
    
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=port,
        log_level="info"
    )
```

#### Step 1.8: Test Backend

```bash
# Make sure venv is activated and you're in backend/
source venv/bin/activate
cd /Users/seang/Downloads/dev/ciper-agent/backend

# Start the server
python main.py

# You should see:
# 🚀 Starting Ciper Agent Backend
# 📡 Ollama URL: http://localhost:11434
# 🌐 Server: http://127.0.0.1:8000
# INFO:     Uvicorn running on http://127.0.0.1:8000
```

#### Step 1.9: Test Endpoints (in another terminal)

```bash
# Health check
curl http://localhost:8000/api/health
# Should return: {"status":"ok","backend":"running","ollama":true,...}

# List models
curl http://localhost:8000/api/models
# Should return: {"models":[...],"count":N}

# Test chat (simple)
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mistral",
    "message": "Hello, what is 2+2?"
  }'
# Should stream response
```

---

### Extension Setup (TypeScript/React)

#### Step 2.1: Generate Extension Scaffold

```bash
# In project root
cd /Users/seang/Downloads/dev/ciper-agent

# Install generator
npm install -g @vscode/generator-code

# Generate extension with questions:
yo code

# Answer as follows:
# ? What type of extension? → New Extension (TypeScript)
# ? Extension name? → ciper-agent
# ? Extension identifier? → ciper-agent
# ? Extension description? → Local AI Agent powered by Ollama
# ? Initialize a git repository? → No (if already a git repo)
# ? Bundle the source code with webpack? → Yes
# ? Which package manager? → npm
# ? Enable stricter TypeScript checking? → Yes

# This creates extension/ folder with full scaffold
```

#### Step 2.2: Install Extension Dependencies

```bash
cd extension

# Install core dependencies
npm install

# Add additional packages for UI
npm install react react-dom highlight.js markdown-it

# Add dev dependencies
npm install -D @types/react @types/highlight.js
npm install -D ts-loader webpack webpack-cli

# List installed packages
npm list
```

#### Step 2.3: Verify Build Works

```bash
# Still in extension/
npm run compile

# Should output:
# > tsc
# Should complete without errors
```

#### Step 2.4: Configure TypeScript

Create/update `extension/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./out",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "exclude": ["node_modules", "**/*.test.ts"]
}
```

#### Step 2.5: Update package.json

Edit `extension/package.json` - key sections:

```json
{
  "name": "ciper-agent",
  "displayName": "Ciper Agent",
  "description": "Local AI Agent powered by Ollama",
  "version": "0.1.0",
  "publisher": "your-publisher-name",
  "engines": {
    "vscode": "^1.84.0",
    "node": ">=14.0.0"
  },
  "categories": ["AI", "Programming Languages"],
  "keywords": ["ai", "copilot", "ollama", "coding"],
  "activationEvents": ["onCommand:ciper.chat"],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "ciper.chat",
        "title": "Open Ciper Chat",
        "category": "Ciper"
      },
      {
        "command": "ciper.switchModel",
        "title": "Switch Model",
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
          "description": "Default AI model to use"
        }
      }
    }
  },
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./",
    "test": "node ./out/test/runTest.js"
  },
  "devDependencies": {
    "@types/vscode": "^1.84.0",
    "@types/node": "^20.x",
    "typescript": "^5.3.3",
    "ts-loader": "^9.5.0",
    "webpack": "^5.89.0",
    "webpack-cli": "^5.1.4"
  }
}
```

#### Step 2.6: Create Basic Extension File

Create `extension/src/extension.ts`:

```typescript
import * as vscode from 'vscode';

let chatPanel: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext) {
    // Register chat command
    let disposable = vscode.commands.registerCommand('ciper.chat', () => {
        if (chatPanel) {
            chatPanel.reveal(vscode.ViewColumn.Beside);
        } else {
            createChatPanel(context);
        }
    });

    context.subscriptions.push(disposable);

    // Register model switcher command
    let switchDisposable = vscode.commands.registerCommand('ciper.switchModel', async () => {
        const models = await fetchModels();
        const selected = await vscode.window.showQuickPick(models);
        
        if (selected) {
            const config = vscode.workspace.getConfiguration('ciper');
            await config.update('defaultModel', selected, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`Switched to model: ${selected}`);
        }
    });

    context.subscriptions.push(switchDisposable);

    // Status bar
    const statusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBar.command = 'ciper.chat';
    statusBar.text = '$(hubot) Ciper';
    statusBar.tooltip = 'Open Ciper Chat';
    statusBar.show();
    context.subscriptions.push(statusBar);

    console.log('✅ Ciper Agent extension activated!');
}

function createChatPanel(context: vscode.ExtensionContext) {
    chatPanel = vscode.window.createWebviewPanel(
        'ciperChat',
        'Ciper Chat',
        vscode.ViewColumn.Beside,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    chatPanel.webview.html = getWebviewContent();

    chatPanel.onDidDispose(() => {
        chatPanel = undefined;
    });

    chatPanel.webview.onDidReceiveMessage(async (message) => {
        if (message.command === 'sendMessage') {
            await sendMessage(message.text, chatPanel!);
        }
    });
}

async function sendMessage(message: string, panel: vscode.WebviewPanel) {
    const backendUrl = vscode.workspace.getConfiguration('ciper').get('backend.url') as string;
    const model = vscode.workspace.getConfiguration('ciper').get('defaultModel') as string;

    try {
        const response = await fetch(`${backendUrl}/api/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                message
            })
        });

        if (response.ok && response.body) {
            const reader = response.body.getReader();
            let fullResponse = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = new TextDecoder().decode(value);
                fullResponse += chunk;

                panel.webview.postMessage({
                    type: 'streamChunk',
                    data: chunk
                });
            }
        }
    } catch (error) {
        panel.webview.postMessage({
            type: 'error',
            data: `Error: ${error}`
        });
    }
}

async function fetchModels(): Promise<string[]> {
    const backendUrl = vscode.workspace.getConfiguration('ciper').get('backend.url') as string;

    try {
        const response = await fetch(`${backendUrl}/api/models`);
        const data = await response.json();
        return data.models.map((m: any) => m.name);
    } catch {
        return ['mistral'];  // Fallback
    }
}

function getWebviewContent(): string {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Ciper Chat</title>
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
                height: 100vh;
                display: flex;
                flex-direction: column;
                background: var(--vscode-editor-background);
                color: var(--vscode-editor-foreground);
            }
            #messages {
                flex: 1;
                overflow-y: auto;
                padding: 16px;
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            .message {
                padding: 12px;
                border-radius: 8px;
                word-wrap: break-word;
            }
            .user-message {
                background: var(--vscode-inputValidation-infoBorder);
                margin-left: 20px;
                text-align: right;
            }
            .ai-message {
                background: var(--vscode-titleBar-activeBackground);
                margin-right: 20px;
            }
            .input-area {
                display: flex;
                gap: 8px;
                padding: 12px;
                border-top: 1px solid var(--vscode-editorGroup-border);
            }
            input {
                flex: 1;
                padding: 8px 12px;
                border: 1px solid var(--vscode-inputBox-border);
                background: var(--vscode-inputBox-background);
                color: var(--vscode-inputBox-foreground);
                border-radius: 4px;
                font-size: 14px;
            }
            button {
                padding: 8px 16px;
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
            }
            button:hover {
                background: var(--vscode-button-hoverBackground);
            }
        </style>
    </head>
    <body>
        <div id="messages"></div>
        <div class="input-area">
            <input type="text" id="input" placeholder="Ask something...">
            <button id="send">Send</button>
        </div>

        <script>
            const vscode = acquireVsCodeApi();
            const messagesDiv = document.getElementById('messages');
            const input = document.getElementById('input');
            const sendButton = document.getElementById('send');

            function addMessage(text, isUser) {
                const div = document.createElement('div');
                div.className = isUser ? 'message user-message' : 'message ai-message';
                div.textContent = text;
                messagesDiv.appendChild(div);
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
            }

            function sendMessage() {
                const text = input.value.trim();
                if (text) {
                    addMessage(text, true);
                    vscode.postMessage({
                        command: 'sendMessage',
                        text: text
                    });
                    input.value = '';
                }
            }

            sendButton.addEventListener('click', sendMessage);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                }
            });

            window.addEventListener('message', (e) => {
                const message = e.data;
                if (message.type === 'streamChunk') {
                    const lastMessage = messagesDiv.lastElementChild;
                    if (lastMessage && !lastMessage.classList.contains('user-message')) {
                        lastMessage.textContent += message.data;
                    }
                } else if (message.type === 'error') {
                    addMessage('Error: ' + message.data, false);
                }
            });
        </script>
    </body>
    </html>`;
}

export function deactivate() {}
```

#### Step 2.7: Compile and Test Extension

```bash
# In extension/ directory
npm run compile

# Should compile without errors
# Check out/ folder was created with compiled JS

# Watch mode for development
npm run watch
# Keep this running while developing
```

#### Step 2.8: Launch Extension in Debug Mode

```bash
# In VS Code, with extension folder open
# Press F5 (Debug → Start Debugging)
# or go to Run → Start Debugging

# This will:
# 1. Compile the extension
# 2. Launch a new VS Code window (Extension Development Host)
# 3. Attach debugger automatically
```

#### Step 2.9: Test Extension

In the Extension Development Host window:
1. Press Cmd+Shift+P to open Command Palette
2. Type "Ciper" and select "Ciper: Open Chat"
3. Chat panel opens on the side
4. Type a message and press Enter
5. Should connect to backend and receive response

---

## Troubleshooting

### Backend Won't Start

```bash
# Check error message
python main.py
# "Address already in use" → port 8000 is taken
#   Solution: Kill process or change BACKEND_PORT

# Check Ollama is running
curl http://localhost:11434/api/tags
# If fails, start: ollama serve
```

### Extension Won't Load

```bash
# Check compiled files exist
ls -la out/
# If empty, run: npm run compile

# Check package.json syntax
npm list
# Should list dependencies without errors

# Check TypeScript errors
npm run compile
# Should show any TS errors
```

### Chat Doesn't Work

```bash
# Check backend health
curl http://localhost:8000/api/health
# Should return JSON with ollama: true

# Check models available
curl http://localhost:8000/api/models
# Should list installed models

# Test direct chat
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"model":"mistral","message":"hi"}'
```

---

## Next Steps

1. ✅ Backend running on http://localhost:8000
2. ✅ Extension loading in VS Code
3. ✅ Basic chat working

### What's Next?
- [Read PLAN.md](../PLAN.md) for complete development roadmap
- [Read EXTENSION-DEV.md](../EXTENSION-DEV.md) for JavaScript/TypeScript patterns
- Add more features:
  - File context awareness
  - Code analysis/suggestions
  - Model switcher in status bar
  - Settings UI

---

**Happy coding! 🚀**
