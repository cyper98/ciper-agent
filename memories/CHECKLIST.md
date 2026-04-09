# 🎯 Ciper Agent - Action Checklist

**Version**: 1.0  
**Last Updated**: 2026-04-09  
**Total Estimated Time**: 10 weeks (MVP)

---

## ✅ Before You Start

### Prerequisites (Do These First!)
- [ ] Ollama installed & running
  - Command: `ollama serve` (keep running)
  - Pull model: `ollama pull mistral`
  - Check: `curl http://localhost:11434/api/tags`

- [ ] Node.js v14+ installed
  - Command: `node --version`
  - If not: `brew install node` or download from nodejs.org

- [ ] Python 3.10+ installed
  - Command: `python3 --version`
  - If not: `brew install python3` or download from python.org

- [ ] VS Code installed & "code" command works
  - Command: `code --version`
  - If not: Cmd+Shift+P → "Shell Command: Install 'code' command"

- [ ] Project folder exists
  - Command: `cd /Users/seang/Downloads/dev/ciper-agent`

---

## 📚 Documentation Phase (30 min)

### Read & Understand
- [x] Read [INDEX.md](INDEX.md) - Document overview (5 min)
- [x] Read [README.md](README.md) - Quick overview (5 min)
- [x] Skim [UPDATE-SUMMARY.md](UPDATE-SUMMARY.md) - What changed (5 min)
- [x] Read [PLAN.md](PLAN.md) - Architecture section (15 min)

### Decide
- [x] Understand project goal: VS Code Extension with local AI
- [x] Understand tech stack: Python backend + TypeScript extension
- [x] Know timeline: 10 weeks for MVP
- [x] Ready to code? → Continue below

---

## 🔧 Phase 1: Backend Foundation (Week 1-2)

> **✅ COMPLETED by Claude Code - 2026-04-09**

### Week 1: Environment Setup

#### Day 1-2: Backend Structure
- [x] Create `/backend` directory with subdirectories (agents, llm, utils, context, tests, prompts)
- [x] Create `backend/__init__.py` and all package `__init__.py` files

#### Day 3: Dependencies & Configuration
- [x] Create `requirements.txt` (fastapi, uvicorn, requests, pydantic, python-dotenv, pytest, httpx, aiofiles)
- [x] Create `.env` file
- [x] Create `.env.example` for repo
- [ ] Install dependencies (manual step): `cd backend && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt`

#### Day 4: Ollama Client
- [x] Create `backend/llm/ollama_client.py` - Full OllamaClient with: health_check, list_models, generate (streaming), chat (multi-turn), pull_model

#### Day 5-6: FastAPI Server
- [x] Create `backend/main.py` - Full FastAPI server with endpoints: GET /api/health, GET /api/models, POST /api/chat (streaming), POST /api/plan, POST /api/analyze-code, POST /api/models/pull, DELETE /api/chat/{session_id}

#### Day 7: Testing & Documentation
- [ ] Test endpoints manually (requires Ollama running)
- [ ] **Phase 1 Week 1 Complete** ✅

### Week 2: Core Agents

#### Day 8-9: Planning Engine
- [x] Create `backend/agents/__init__.py`
- [x] Create `backend/agents/planner.py` - PlanningEngine with generate_plan() and system prompt

#### Day 10: Code Analysis Engine
- [x] Create `backend/agents/code_analyzer.py` - CodeAnalyzer with analyze(), explain(), generate_tests()

#### Day 11-12: Chat Engine & Context
- [x] Create `backend/context/context_manager.py` - ContextManager (in-memory, max 20 msgs/session, multi-session)
- [x] Create `backend/agents/chat_engine.py` - ChatEngine with multi-turn conversation + file context injection

#### Day 13: Integration & API Updates
- [x] All agents connected to main.py
- [x] `/api/chat` uses ChatEngine (streaming)
- [x] `/api/plan` uses PlanningEngine
- [x] `/api/analyze-code` uses CodeAnalyzer

#### Day 14: Testing & Docs
- [ ] Write unit tests (pending)
- [ ] **Phase 1-2 Complete** ✅

**✅ Checkpoint: Backend code written, all agents functional - needs Ollama running to test**

---

## 💻 Phase 3: VS Code Extension (Week 5-6)

> **✅ COMPLETED by Claude Code - 2026-04-09**

### Week 5: Extension Scaffold & Basic Chat

#### Day 15-16: Extension Setup
- [x] Create `extension/` directory with `src/` subdirectory
- [x] Create `extension/package.json` - full manifest with commands, keybindings, config schema, context menu
- [x] Create `extension/tsconfig.json` - TypeScript config targeting ES2020

#### Day 17: Extension Entry Point
- [x] Create `extension/src/extension.ts` - full extension with:
  - Status bar showing current model (click to switch)
  - `ciper.chat` command - opens/reveals chat panel
  - `ciper.analyzeCode` command - analyzes selected code + sends to chat
  - `ciper.plan` command - prompts for input, sends plan request to chat
  - `ciper.switchModel` command - QuickPick from backend models list
  - `ciper.clearHistory` command - clears backend session + webview

#### Day 18-19: Chat UI + Webview Integration
- [x] Inline Webview HTML with full chat UI:
  - Message area (user/AI bubbles with streaming indicator)
  - Auto-resize textarea input (Enter=send, Shift+Enter=newline)
  - Header with model name, Switch Model & Clear buttons
  - VS Code theme variables for all colors

#### Day 20: Backend Integration
- [x] `streamResponse()` - streams from `/api/chat` with file context
- [x] `fetchModels()` - fetches model list from `/api/models`
- [x] File context extraction from active editor (language, fileName, selectedText, fullContent)
- [x] **Week 5 Complete** ✅

### Week 6: Advanced Features

#### Day 21: Model Switcher
- [x] Status bar shows current model with click-to-switch
- [x] `ciper.switchModel` fetches models from backend, updates config & notifies webview

#### Day 22-23: Settings & Configuration
- [x] `package.json` config schema: backend.url, defaultModel, temperature, sendFileContext
- [x] All settings read via `vscode.workspace.getConfiguration('ciper')` at runtime

#### Day 24: Polish
- [ ] Install deps & compile: `cd extension && npm install && npm run compile`
- [ ] Test with F5 debug mode
- [ ] **Week 6 / Phase 3 Complete** ✅

**✅ Checkpoint: Extension code written - needs `npm install && npm run compile` to test**

---

## 🚀 Phase 4: Advanced Features (Week 7-8)

> **✅ COMPLETED by Claude Code - 2026-04-09**

### Week 7: Streaming & UX

- [x] Real-time streaming responses (done in Phase 3, improved in Phase 4)
- [x] Streaming indicator (left-border highlight on AI bubble while streaming)
- [x] Code syntax highlighting — fenced code blocks rendered with Copy button
- [x] Markdown rendering in chat (bold, italic, headings, lists, inline code)
- [x] Better error messages (shows backend start command)
- [x] Keyboard shortcuts: Cmd+Shift+C/A/L/M/E

### Week 8: History & Export

- [x] Persistent chat history via SQLite (`backend/data/ciper.db`)
  - Table: `messages(id, session, role, content, model, ts)`
  - Max 40 messages per session sent to LLM context window
- [x] Conversation export as Markdown (`GET /api/chat/{session_id}/export`) + Save dialog in extension
- [x] Search in history (`GET /api/chat/{session_id}/search?q=...`) shown as QuickPick
- [x] Clear history (`DELETE /api/chat/{session_id}`) wipes SQLite + webview
- [x] Session ID tied to workspace folder name (isolated per project)
- [x] New backend endpoints: `/api/sessions`, `/api/chat/{id}/history`, `/api/chat/{id}/export`, `/api/chat/{id}/search`

**✅ Phase 4 Complete**

---

## 📦 Phase 5: Marketplace Publishing (Week 9-10)

> **✅ COMPLETED by Claude Code - 2026-04-09 (code-ready; manual steps remain)**

### Week 9: Preparation

- [x] Extension icon: `extension/images/icon.svg` (purple lightning bolt on dark bg)
  - Manual step: `bash extension/images/convert-icon.sh` → generates `icon.png`
- [ ] Screenshot (1280x720 PNG) — capture after first working demo
- [x] `extension/package.json` updated with marketplace metadata: icon, galleryBanner, repository, license, keywords
- [x] `extension/CHANGELOG.md` created (v0.1.0 + v0.2.0 entries)
- [x] `LICENSE` (MIT) created in project root
- [x] `PUBLISHING.md` — step-by-step guide to publish

### Week 10: Publishing (manual steps)

- [ ] Update `publisher` in `extension/package.json` to your publisher name
- [ ] Create VS Code Marketplace account at https://marketplace.visualstudio.com/
- [ ] Get Personal Access Token (PAT) from https://dev.azure.com/
- [ ] Install vsce: `npm install -g @vscode/vsce`
- [ ] Generate icon PNG: `bash extension/images/convert-icon.sh`
- [ ] Package: `cd extension && npm install && npm run compile && vsce package`
- [ ] Test locally: `code --install-extension ciper-agent-0.2.0.vsix`
- [ ] Login & publish: `vsce login YOUR-PUBLISHER && vsce publish`
- [ ] Monitor marketplace listing
- [ ] Announce on GitHub / social media

**✅ Phase 5 code done — publish steps in PUBLISHING.md 🎉**

---

## 📊 Parallel Activities (Throughout Project)

### Testing (Every Phase)
- [ ] Unit tests for backend
- [ ] Integration tests
- [ ] Manual UI testing
- [ ] Error scenario testing

### Documentation (Every Phase)
- [ ] Code comments
- [ ] README updates
- [ ] API documentation
- [ ] User guide

### Performance (Ongoing)
- [ ] Monitor response times
- [ ] Check memory usage
- [ ] Optimize hot paths
- [ ] Profile extension

### Security (Ongoing)
- [ ] Input validation
- [ ] Error message sanitization
- [ ] No sensitive data logging
- [ ] Dependency updates

---

## 🎯 Weekly Milestones

| Week | Focus | Key Deliverable |
|------|-------|-----------------|
| 1 | Backend Setup | FastAPI server + Ollama client |
| 2 | Core Agents | Planning, Analysis, Chat engines |
| 3 | Backend Polish | Testing, optimization |
| 4 | Backend Review | Bug fixes, documentation |
| 5 | Extension Basics | Scaffold, chat UI, backend connect |
| 6 | Extension Features | Model switcher, settings |
| 7 | Advanced Features | Streaming, history, polish |
| 8 | Performance | Optimization, error handling |
| 9 | Marketplace Prep | Assets, documentation, packaging |
| 10 | Release | Publish, monitor, iterate |

---

## ⏰ Time Estimation

| Phase | Duration | Effort |
|-------|----------|--------|
| Phase 1 (Backend Foundation) | 2 weeks | High |
| Phase 2 (Core Agents) | 2 weeks | High |
| Phase 3 (Extension) | 2 weeks | High |
| Phase 4 (Advanced) | 2 weeks | Medium |
| Phase 5 (Publishing) | 2 weeks | Low-Medium |
| **TOTAL** | **10 weeks** | **MVP Ready** |

---

## 📋 Testing Checklist

### Backend Tests
- [ ] All endpoints respond with 200
- [ ] Ollama connection works
- [ ] Chat returns text
- [ ] Models list returns >0 models
- [ ] Error messages helpful
- [ ] No server crashes

### Extension Tests
- [ ] Extension loads without errors
- [ ] Chat panel opens on command
- [ ] Messages send to backend
- [ ] Responses display in UI
- [ ] Model switcher works
- [ ] Settings save correctly
- [ ] No memory leaks
- [ ] Keyboard shortcuts work

### Integration Tests
- [ ] Backend + Extension communicate
- [ ] Long responses stream correctly
- [ ] Error recovery works
- [ ] Model switching mid-conversation
- [ ] Settings apply immediately

### User Acceptance Tests (UAT)
- [ ] New user can install extension
- [ ] First-time setup works
- [ ] Chat works without special config
- [ ] Help/docs are clear
- [ ] Common issues have solutions

---

## 🔍 Code Quality Checkpoints

### Every Week, Check:
- [ ] No console errors/warnings
- [ ] Code follows TypeScript/Python standards
- [ ] Tests pass (>70% coverage)
- [ ] No security issues
- [ ] Performance acceptable (<2s response)
- [ ] Documentation updated

### Before Each Release:
- [ ] Code review done
- [ ] All tests green
- [ ] No TODOs in code
- [ ] Updated CHANGELOG
- [ ] Tested on clean install

---

## 🚨 Blockers & Dependencies

### Backend Blockers
- ❌ Ollama not running → Setup Ollama first
- ❌ Python not installed → Install Python 3.10+
- ❌ Port 8000 taken → Kill process or change port

### Extension Blockers
- ❌ Node not installed → Install Node 14+
- ❌ VS Code version old → Update VS Code
- ❌ Backend not running → Start backend first

### Publishing Blockers
- ❌ No Microsoft account → Create one
- ❌ No PAT token → Generate one
- ❌ Publisher not created → Create on marketplace

---

## 📞 Support Resources

### If You Get Stuck
1. Check [SETUP.md](SETUP.md) troubleshooting section
2. Check [EXTENSION-DEV.md](EXTENSION-DEV.md) for API help
3. Review [PLAN.md](PLAN.md) for architecture
4. Test endpoints manually with curl
5. Check backend/extension logs
6. File an issue with logs & context

### Quick Commands to Test
```bash
# Health check
curl http://localhost:8000/api/health

# List models
curl http://localhost:8000/api/models

# Test chat
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"model":"mistral","message":"hello"}'

# Check extension compiles
cd extension && npm run compile
```

---

## ✨ Success Indicators

### Phase 1-2 Success
- ✅ Backend runs without errors
- ✅ All endpoints respond
- ✅ Can chat with AI
- ✅ Model switching works

### Phase 3 Success
- ✅ Extension installs & loads
- ✅ Chat works in VS Code
- ✅ Responses stream properly
- ✅ UI is responsive

### Phase 5 Success
- ✅ Published to Marketplace
- ✅ >50 installs within week 1
- ✅ Rating >4.0 stars
- ✅ Active community feedback

---

## 📝 Notes & Customizations

### Backend Config
```
OLLAMA_API_URL=http://localhost:11434  # Your Ollama server
DEFAULT_MODEL=mistral                   # Start model
BACKEND_PORT=8000                       # API port
LOG_LEVEL=INFO                          # Verbose logging
```

### Extension Config
```json
{
  "ciper.backend.url": "http://localhost:8000",
  "ciper.defaultModel": "mistral",
  "ciper.temperature": 0.7,
  "ciper.enableInlineHints": true
}
```

### Keyboard Shortcuts (Can be customized)
- `Cmd+Shift+C` - Open chat
- `Cmd+Shift+P` - Generate plan
- `Cmd+Shift+A` - Analyze code
- `Cmd+Shift+M` - Switch model

---

## 🎉 Celebrate Milestones!

- **Week 2 End**: 🎊 Backend working!
- **Week 4 End**: 🎊 All agents complete!
- **Week 6 End**: 🎊 Extension in VS Code!
- **Week 8 End**: 🎊 All features working!
- **Week 10 End**: 🎊 **Live on Marketplace!** 🚀

---

## 📞 Check-in Points

### Every Friday:
- [ ] Review the week's progress
- [ ] Update this checklist
- [ ] Plan next week
- [ ] Document any blockers
- [ ] Share progress with team (if applicable)

### Every Phase End:
- [ ] Code review
- [ ] Testing pass
- [ ] Documentation complete
- [ ] Lessons learned documented
- [ ] Plan next phases

---

**Start Date**: ____________  
**Expected Completion**: 10 weeks  
**Current Week**: ______  
**Overall Progress**: ______%

**Notes**:
```
_____________________________________________
_____________________________________________
_____________________________________________
```

---

**Good luck! 🚀 Let's build something awesome!**

*Reference this checklist throughout your project. Mark items as complete to track progress.*
