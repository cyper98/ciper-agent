# Ciper Agent - Local AI Coding Agent with VS Code Extension

![GitHub License](https://img.shields.io/badge/license-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue)
![Python](https://img.shields.io/badge/Python-3.10+-green)
![VS Code](https://img.shields.io/badge/VS%20Code-1.84+-blue)

**Ciper Agent** là một agent AI local được chạy hoàn toàn trên máy của bạn, tương tự như Copilot hay Claude Code Chat, nhưng với toàn quyền kiểm soát, hoàn toàn miễn phí, và có thể sử dụng offline.

## ✨ Features

### 🎯 Core Capabilities
- **Chat AI**: Trò chuyện với Ollama models trực tiếp từ VS Code
- **Code Analysis**: Phân tích, gợi ý, và sửa lỗi code
- **Planning**: Tạo plans và workflows từ yêu cầu
- **Model Switching**: Chuyển đổi giữa các Ollama models linh hoạt
- **Context Aware**: Tự động hiểu ngữ cảnh file hiện tại
- **Streaming Responses**: Nhận response real-time khi AI suy luận

### 🚀 Technical Features
- ✅ Local-only processing (no cloud, no tracking)
- ✅ TypeScript VS Code Extension
- ✅ Python FastAPI Backend
- ✅ Real-time streaming responses
- ✅ Persistent conversation history
- ✅ Multi-model support
- ✅ Custom prompt engineering

---

## 📦 Prerequisites

### Required
- **Ollama** running locally
  - [Download Ollama](https://ollama.ai)
  - Installation: `ollama serve` (background process)
  - At least 1 model: `ollama pull mistral`

- **Node.js** v14+ (for VS Code Extension)
  - [Download Node.js](https://nodejs.org/)

- **Python** 3.10+ (for Backend)
  - [Download Python](https://python.org/)

- **VS Code** v1.84+ (to run extension)
  - [Download VS Code](https://code.visualstudio.com/)

### Recommended
- 8GB+ RAM (for running Ollama models)
- GPU support (NVIDIA CUDA or Metal on Mac)
- Multiple Ollama models installed

---

## 🚀 Quick Start

### 1. Start Ollama
```bash
# Terminal 1: Start Ollama server
ollama serve

# In another terminal, pull a model
ollama pull mistral
olama pull codellama  # Optional: specialized for code

# Check available models
ollama list
```

### 2. Cloneclone/Setup Backend
```bash
# Clone/init this repo
cd /Users/seang/Downloads/dev/ciper-agent

# Create virtual environment
python -m venv venv
source venv/bin/activate

# Install dependencies
cd backend
pip install -r requirements.txt

# Configure (optional)
cp .env.example .env
# Edit .env if needed (default works for local Ollama)

# Start backend server
python main.py
# Server runs on http://localhost:8000
```

### 3. Install VS Code Extension
```bash
# Terminal 3: Build and run extension
cd extension
npm install
npm run watch

# In VS Code:
# Press F5 to launch Extension Development Host
```

### 4. Use in VS Code
1. The Extension Development Host opens a new VS Code window
2. Use command palette: `Cmd+Shift+P` → "Ciper: Open Chat"
3. Start chatting!

---

## 📁 Project Structure

```
ciper-agent/
│
├── backend/                    # Python FastAPI server
│   ├── main.py                 # Entry point
│   ├── agents/                 # AI agents
│   ├── llm/                    # Ollama client
│   ├── requirements.txt        # Dependencies
│   └── .env.example
│
├── extension/                  # VS Code Extension
│   ├── src/
│   │   ├── extension.ts        # Entry point
│   │   ├── views/              # UI components
│   │   └── utils/              # Helpers
│   ├── package.json            # Manifest
│   └── tsconfig.json
│
├── docs/                       # Documentation
│   ├── PLAN.md                 # Full development plan
│   ├── EXTENSION-DEV.md        # Extension guide
│   └── API.md                  # Backend API docs
│
└── README.md                   # This file
```

---

## 🎓 Available Commands

### VS Code Command Palette
| Command | Shortcut | Description |
|---------|----------|-------------|
| Ciper: Chat | `Cmd+Shift+C` | Open chat panel |
| Ciper: Plan | `Cmd+Shift+P` | Generate plan for selection |
| Ciper: Analyze Code | `Cmd+Shift+A` | Analyze selected code |
| Ciper: Switch Model | `Cmd+Shift+M` | Choose AI model |

### Status Bar
- Click model name to quickly switch models
- Shows current model and connection status

---

## ⚙️ Configuration

### Settings (VS Code)
```json
{
  "ciper.backend.url": "http://localhost:8000",
  "ciper.defaultModel": "mistral",
  "ciper.temperature": 0.7,
  "ciper.enableInlineHints": true
}
```

### Environment Variables (Backend)
Create `backend/.env`:
```bash
OLLAMA_API_URL=http://localhost:11434
DEFAULT_MODEL=mistral
LOG_LEVEL=INFO
BACKEND_PORT=8000
```

---

## 🔄 Workflow

### Typical Usage Flow
```
1. Type question in chat panel
   ↓
2. Select code snippet if needed
   ↓
3. Press Enter to send
   ↓
4. AI analyzes context + code
   ↓
5. Response streams in real-time
   ↓
6. Copy code or apply suggestions
```

### Available AI Operations
```
Chat        → General conversation
Plan        → Break down problems
Analyze     → Find bugs & improvements
Explain     → Understand code
Refactor    → Improve structure
Test        → Generate test cases
```

---

## 🐛 Troubleshooting

### Connection Issues
```bash
# Check if backend is running
curl http://localhost:8000/api/health

# Check if Ollama is running
curl http://localhost:11434/api/tags
```

### Extension Won't Load
1. Check VS Code version (1.84+)
2. Check Node.js version (14+)
3. Run: `npm run compile` in extension folder
4. Press F5 to debug

### No Models Available
```bash
# List installed models
ollama list

# Pull a model
ollama pull mistal
```

### Slow Responses
- Use smaller models (mistral ~7B)
- Enable GPU acceleration (CUDA/Metal)
- Check CPU/RAM usage
- Consider model quantization

---

## 📚 Documentation

### Deep Dives
- **[PLAN.md](PLAN.md)** - Complete development roadmap & architecture
- **[EXTENSION-DEV.md](EXTENSION-DEV.md)** - VS Code Extension development guide
- **[API.md](docs/API.md)** - Backend API documentation (coming soon)

### Quick Guides
- [Setup Guide](docs/SETUP.md)
- [Usage Guide](docs/USAGE.md)
- [Deployment Guide](docs/DEPLOYMENT.md)

---

## 🛠️ Development

### Building from Source
```bash
# Backend
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python main.py

# Extension
cd extension
npm install
npm run compile
# Press F5 in VS Code to test
```

### Running Tests
```bash
# Backend tests
cd backend
pytest

# Extension tests
cd extension
npm test
```

### Contributing
We welcome contributions! Please:
1. Fork the repository
2. Create a feature branch
3. Submit a pull request

---

## 🚀 Deployment Options

### Local Only (Default)
- Extension + Backend run on same machine
- Ollama runs locally or on accessible LAN
- ✅ Fastest, most private

### Remote Backend (Optional)
- Extension connects to remote FastAPI server
- Update `ciper.backend.url` in settings
- ✅ Run backend on more powerful machine

---

## 📊 Performance

### Typical Metrics
| Operation | Model | Time | Memory |
|-----------|-------|------|--------|
| Chat response | Mistral 7B | 5-10s | 4GB |
| Code analysis | Codellama 7B | 3-8s | 4GB |
| Plan generation | Mistral 13B | 10-15s | 6GB |

### Optimization Tips
1. **Use smaller models** for dev (Mistral, not Llama2 70B)
2. **Enable quantization** (Q4, Q5 variants)
3. **Add GPU support** (5-10x faster)
4. **Offload layers** if VRAM limited

---

## 🔐 Privacy & Security

### Data Handling
- ✅ All processing on local machine
- ✅ No data sent to cloud
- ✅ No tracking or telemetry
- ✅ No API keys required
- ✅ Full source code available

### File Access
- Chat can see current editor file
- Can analyze project structure
- Read/write only when you allow

---

## 📈 Roadmap

### Phase 1 (Current - MVP)
- [x] Ollama integration
- [x] FastAPI backend
- [x] VS Code Extension basic
- [x] Chat interface
- [x] Model switching

### Phase 2 (Next)
- [ ] Code lens inline hints
- [ ] Streaming text file output
- [ ] Conversation export
- [ ] Keyboard shortcuts customization

### Phase 3 (Future)
- [ ] Multi-file context
- [ ] Git integration
- [ ] Custom prompt templates
- [ ] Plugin architecture

---

## 📄 License

MIT License - See [LICENSE](LICENSE) file

---

## 🤝 Support

### Getting Help
1. Check [troubleshooting](#-troubleshooting) section
2. Search [GitHub Issues](https://github.com/yourusername/ciper-agent/issues)
3. Discuss on GitHub Discussions
4. File a bug report with details

### Feedback
- Feature requests → GitHub Issues
- Bug reports → GitHub Issues with logs
- General feedback → GitHub Discussions

---

## 🎉 Credits

Built with:
- [Ollama](https://ollama.ai) - Local LLM engine
- [FastAPI](https://fastapi.tiangolo.com/) - Backend API
- [VS Code Extension API](https://code.visualstudio.com/api)
- [React](https://react.dev/) - UI framework

---

## 📝 Changelog

### v0.1.0 (Initial Release - 2026-04)
- Basic extension UI
- Chat functionality
- Model switching
- File context awareness
- Conversation history

---

**Made with ❤️ for local AI development**

Get started now: [Quick Start Guide](#-quick-start)

Questions? File an issue or check [PLAN.md](PLAN.md) for detailed architecture.
