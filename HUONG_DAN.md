# Ciper Agent — Hướng dẫn sử dụng

## Yêu cầu
- [Node.js](https://nodejs.org) >= 18
- [Ollama](https://ollama.com) đang chạy (`ollama serve`)
- Đã pull ít nhất 1 model, ví dụ: `ollama pull qwen2.5-coder:7b`

---

## Build

```bash
# 1. Cài dependencies
npm install

# 2. Build toàn bộ (shared + frontend + backend)
npm run build

# 3. Đóng gói thành file .vsix
cd backend
npx @vscode/vsce package --no-dependencies
```

File output: `backend/ciper-agent-0.1.0.vsix`

---

## Cài vào VSCode

```bash
code --install-extension backend/ciper-agent-0.1.0.vsix
```

Hoặc trong VSCode: **Extensions** (`Ctrl+Shift+X`) → `...` → **Install from VSIX…** → chọn file trên.

---

## Sử dụng

| Tính năng | Cách dùng |
|-----------|-----------|
| Mở chat | Click icon **◈** trên Activity Bar, hoặc `Ctrl+Alt+I` |
| Gửi tin | Gõ vào ô chat → Enter |
| Chế độ Agent | Bấm nút **⚙ Agent** → nhập yêu cầu → agent tự động đọc/sửa file |
| Slash command | Gõ `/explain`, `/fix`, `/tests`, `/review`, `/docs` |
| Chọn model | Dropdown model ở thanh dưới cùng (tự load từ Ollama) |
| Ask Ciper | Chọn đoạn code → chuột phải → **Ask Ciper** |
| Dừng agent | Bấm **■ Stop** hoặc `Ctrl+Shift+I` |

### Luồng chỉnh sửa file (Agent mode)
1. Agent đề xuất thay đổi → hiện **diff** ngay trong chat
2. Bấm **✓ Apply Changes** để áp dụng, hoặc **✗ Discard** để huỷ

---

## Cấu hình (tuỳ chọn)

Vào **Settings** (`Ctrl+,`) → tìm `ciperAgent`:

| Setting | Mặc định | Mô tả |
|---------|----------|-------|
| `ciperAgent.ollamaEndpoint` | `http://localhost:11434` | Địa chỉ Ollama |
| `ciperAgent.model` | `qwen2.5-coder:7b` | Model mặc định |
| `ciperAgent.contextTokenBudget` | `8192` | Giới hạn token context |

---

## Dev (watch mode)

```bash
# Terminal 1 — build khi có thay đổi
npm run watch

# Terminal 2 — mở VSCode với extension debug
code --extensionDevelopmentPath=$PWD/backend
```

Hoặc nhấn **F5** trong VSCode để mở Extension Development Host.
