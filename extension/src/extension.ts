import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

let chatPanel: vscode.WebviewPanel | undefined;
let statusBar: vscode.StatusBarItem;
let currentModel = 'mistral';

interface FileContext {
    language: string;
    fileName: string;
    selectedText: string;
    fullContent: string;
    projectRoot: string;
}

interface ProjectContext {
    rootName: string;
    tree: string[];
    keyFiles: Record<string, string>;
}

// Key files to read content (capped per file)
const KEY_FILE_NAMES = [
    'package.json', 'package-lock.json',
    'requirements.txt', 'pyproject.toml', 'setup.py',
    'README.md', 'README.rst',
    'Dockerfile', 'docker-compose.yml',
    'tsconfig.json', '.eslintrc.json',
    'main.py', 'app.py', 'run.py', 'server.py',
    'index.ts', 'index.js', 'main.ts', 'main.js',
    'src/index.ts', 'src/main.ts', 'src/app.ts',
    'src/index.js', 'src/main.js',
];

// Folders to skip when scanning
const EXCLUDE_GLOB = '{**/node_modules/**,**/.git/**,**/venv/**,**/env/**,**/.venv/**,**/dist/**,**/out/**,**/build/**,**/__pycache__/**,**/.next/**,**/.cache/**}';
const MAX_FILE_BYTES = 4000;   // chars per key file
const MAX_TREE_ENTRIES = 200;  // max paths in tree

export function activate(context: vscode.ExtensionContext) {
    // ── Status Bar ────────────────────────────────────────────────────────────
    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.command = 'ciper.switchModel';
    statusBar.tooltip = 'Ciper Agent — click to switch model';
    updateStatusBar();
    statusBar.show();
    context.subscriptions.push(statusBar);

    // ── Commands ──────────────────────────────────────────────────────────────
    context.subscriptions.push(

        vscode.commands.registerCommand('ciper.chat', () => {
            if (chatPanel) {
                chatPanel.reveal(vscode.ViewColumn.Beside);
            } else {
                createChatPanel(context);
            }
        }),

        vscode.commands.registerCommand('ciper.analyzeCode', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('Ciper: Open a file first.');
                return;
            }
            const selected = editor.document.getText(editor.selection);
            if (!selected) {
                vscode.window.showWarningMessage('Ciper: Select some code first.');
                return;
            }
            openOrRevealPanel(context);
            const fc = getFileContext(editor);
            const message = `Please analyze this code:\n\`\`\`${fc.language}\n${selected}\n\`\`\``;
            await sendToPanel(message, fc);
        }),

        vscode.commands.registerCommand('ciper.plan', async () => {
            const input = await vscode.window.showInputBox({
                prompt: 'What do you want to plan?',
                placeHolder: 'Describe your feature or task…',
            });
            if (!input) return;
            openOrRevealPanel(context);
            await sendToPanel(`Create a detailed plan for: ${input}`, {});
        }),

        vscode.commands.registerCommand('ciper.switchModel', async () => {
            const models = await fetchModels();
            if (!models.length) {
                vscode.window.showErrorMessage('Ciper: No models found. Is Ollama running?');
                return;
            }
            const selected = await vscode.window.showQuickPick(models, {
                placeHolder: `Current model: ${currentModel}`,
            });
            if (selected) {
                currentModel = selected;
                const config = vscode.workspace.getConfiguration('ciper');
                await config.update('defaultModel', selected, vscode.ConfigurationTarget.Global);
                updateStatusBar();
                vscode.window.showInformationMessage(`Ciper: Switched to ${selected}`);
                chatPanel?.webview.postMessage({ type: 'modelChanged', model: selected });
            }
        }),

        vscode.commands.registerCommand('ciper.clearHistory', async () => {
            const sessionId = getSessionId();
            const backendUrl = getBackendUrl();
            try {
                await fetch(`${backendUrl}/api/chat/${sessionId}`, { method: 'DELETE' });
                chatPanel?.webview.postMessage({ type: 'clearHistory' });
                vscode.window.showInformationMessage('Ciper: Chat history cleared.');
            } catch {
                vscode.window.showErrorMessage('Ciper: Could not clear history (backend offline?)');
            }
        }),

        vscode.commands.registerCommand('ciper.exportChat', async () => {
            const sessionId = getSessionId();
            const backendUrl = getBackendUrl();
            try {
                const res = await fetch(`${backendUrl}/api/chat/${sessionId}/export`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const markdown = await res.text();

                const uri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(`ciper-${sessionId}.md`),
                    filters: { Markdown: ['md'] },
                });
                if (uri) {
                    fs.writeFileSync(uri.fsPath, markdown, 'utf8');
                    vscode.window.showInformationMessage(`Ciper: Exported to ${uri.fsPath}`);
                    vscode.env.openExternal(uri);
                }
            } catch (e) {
                vscode.window.showErrorMessage(`Ciper: Export failed — ${e}`);
            }
        }),

        vscode.commands.registerCommand('ciper.analyzeProject', async () => {
            const ws = vscode.workspace.workspaceFolders?.[0];
            if (!ws) {
                vscode.window.showWarningMessage('Ciper: Open a workspace folder first.');
                return;
            }

            openOrRevealPanel(context);

            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Ciper: Scanning project…', cancellable: false },
                async () => {
                    const projectCtx = await getWorkspaceContext();
                    const fileCount = projectCtx.tree.length;
                    const keyCount  = Object.keys(projectCtx.keyFiles).length;
                    const message = `Phân tích dự án này cho tôi:\n- Mục đích và chức năng chính\n- Kiến trúc và luồng xử lý\n- Các dependencies chính\n- Điểm có thể tối ưu hoặc cải thiện`;

                    // Small delay so panel can initialise
                    await new Promise(r => global.setTimeout(r, 400));
                    chatPanel?.webview.postMessage({ type: 'injectMessage', text: message });
                    await streamResponse(message, {}, chatPanel!, projectCtx);

                    vscode.window.showInformationMessage(
                        `Ciper: Scanned ${fileCount} files, read ${keyCount} key files.`
                    );
                }
            );
        }),

        vscode.commands.registerCommand('ciper.searchHistory', async () => {
            const query = await vscode.window.showInputBox({
                prompt: 'Search in chat history',
                placeHolder: 'Type a keyword…',
            });
            if (!query) return;

            const sessionId = getSessionId();
            const backendUrl = getBackendUrl();
            try {
                const res = await fetch(`${backendUrl}/api/chat/${sessionId}/search?q=${encodeURIComponent(query)}`);
                const data = await res.json() as { results: { role: string; content: string; ts: string }[]; count: number };

                if (!data.count) {
                    vscode.window.showInformationMessage(`Ciper: No results for "${query}"`);
                    return;
                }

                const items = data.results.map(r => ({
                    label: r.role === 'user' ? '$(account) You' : '$(hubot) Ciper',
                    description: r.ts,
                    detail: r.content.slice(0, 120) + (r.content.length > 120 ? '…' : ''),
                }));

                await vscode.window.showQuickPick(items, {
                    placeHolder: `${data.count} result(s) for "${query}"`,
                    matchOnDetail: true,
                });
            } catch (e) {
                vscode.window.showErrorMessage(`Ciper: Search failed — ${e}`);
            }
        })
    );

    // Load last model from settings
    const config = vscode.workspace.getConfiguration('ciper');
    currentModel = config.get<string>('defaultModel', 'mistral');
    updateStatusBar();

    console.log('Ciper Agent extension activated');
}

// ── Panel Management ─────────────────────────────────────────────────────────

function openOrRevealPanel(context: vscode.ExtensionContext) {
    if (chatPanel) {
        chatPanel.reveal(vscode.ViewColumn.Beside);
    } else {
        createChatPanel(context);
    }
}

function createChatPanel(context: vscode.ExtensionContext) {
    chatPanel = vscode.window.createWebviewPanel(
        'ciperChat',
        'Ciper Chat',
        vscode.ViewColumn.Beside,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
        }
    );

    chatPanel.webview.html = getWebviewContent();

    chatPanel.onDidDispose(() => { chatPanel = undefined; });

    chatPanel.webview.onDidReceiveMessage(async (msg) => {
        switch (msg.command) {
            case 'sendMessage': {
                const editor = vscode.window.activeTextEditor;
                const fc = (editor && getFileContextEnabled()) ? getFileContext(editor) : {};
                // If workspace exists, always attach project tree for richer context
                const pc = vscode.workspace.workspaceFolders ? await getWorkspaceContext() : {};
                await streamResponse(msg.text, fc, chatPanel!, pc);
                break;
            }
            case 'analyzeProject':
                await vscode.commands.executeCommand('ciper.analyzeProject');
                break;
            case 'switchModel':
                await vscode.commands.executeCommand('ciper.switchModel');
                break;
            case 'clearHistory':
                await vscode.commands.executeCommand('ciper.clearHistory');
                break;
            case 'exportChat':
                await vscode.commands.executeCommand('ciper.exportChat');
                break;
            case 'searchHistory':
                await vscode.commands.executeCommand('ciper.searchHistory');
                break;
        }
    });

    chatPanel.webview.postMessage({ type: 'init', model: currentModel });
}

async function sendToPanel(message: string, fileContext: object) {
    await new Promise(r => setTimeout(r, 300));
    chatPanel?.webview.postMessage({ type: 'injectMessage', text: message });
    await streamResponse(message, fileContext, chatPanel!);
}

// ── Backend Communication ────────────────────────────────────────────────────

async function streamResponse(
    message: string,
    fileContext: object,
    panel: vscode.WebviewPanel,
    projectContext: ProjectContext | object = {}
) {
    const backendUrl = getBackendUrl();
    const model = getCurrentModel();

    panel.webview.postMessage({ type: 'streamStart' });

    try {
        const response = await fetch(`${backendUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                message,
                session_id: getSessionId(),
                temperature: getTemperature(),
                file_context: fileContext,
                project_context: projectContext,
            }),
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        if (response.body) {
            const reader = response.body.getReader();
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                panel.webview.postMessage({ type: 'streamChunk', data: new TextDecoder().decode(value) });
            }
        }
    } catch (error) {
        panel.webview.postMessage({
            type: 'error',
            data: `Failed to reach backend: ${error}\n\nMake sure the backend is running:\n  cd backend && python main.py`,
        });
    }

    panel.webview.postMessage({ type: 'streamEnd' });
}

async function fetchModels(): Promise<string[]> {
    try {
        const res = await fetch(`${getBackendUrl()}/api/models`);
        const data = await res.json() as { models: { name: string }[] };
        return data.models.map(m => m.name);
    } catch {
        return ['mistral'];
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getFileContext(editor: vscode.TextEditor): FileContext {
    return {
        language: editor.document.languageId,
        fileName: editor.document.fileName,
        selectedText: editor.document.getText(editor.selection),
        fullContent: editor.document.getText(),
        projectRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
    };
}

function getBackendUrl(): string {
    return vscode.workspace.getConfiguration('ciper').get<string>('backend.url', 'http://localhost:8000');
}

function getCurrentModel(): string {
    return vscode.workspace.getConfiguration('ciper').get<string>('defaultModel', currentModel);
}

function getTemperature(): number {
    return vscode.workspace.getConfiguration('ciper').get<number>('temperature', 0.7);
}

function getFileContextEnabled(): boolean {
    return vscode.workspace.getConfiguration('ciper').get<boolean>('sendFileContext', true);
}

async function getWorkspaceContext(): Promise<ProjectContext> {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) { return { rootName: '', tree: [], keyFiles: {} }; }

    const rootName = ws.name;

    // ── File tree ─────────────────────────────────────────────────────────────
    const uris = await vscode.workspace.findFiles('**/*', EXCLUDE_GLOB, MAX_TREE_ENTRIES);
    const tree = uris
        .map(u => vscode.workspace.asRelativePath(u))
        .sort();

    // ── Key file contents ─────────────────────────────────────────────────────
    const keyFiles: Record<string, string> = {};
    for (const name of KEY_FILE_NAMES) {
        try {
            const uri = vscode.Uri.joinPath(ws.uri, name);
            const bytes = await vscode.workspace.fs.readFile(uri);
            const text  = Buffer.from(bytes).toString('utf8');
            keyFiles[name] = text.length > MAX_FILE_BYTES ? text.slice(0, MAX_FILE_BYTES) + '\n…(truncated)' : text;
        } catch {
            // file doesn't exist — skip silently
        }
    }

    return { rootName, tree, keyFiles };
}

function getSessionId(): string {
    // One session per workspace folder; falls back to "default"
    return vscode.workspace.workspaceFolders?.[0]?.name ?? 'default';
}

function updateStatusBar() {
    statusBar.text = `$(hubot) ${currentModel}`;
}

// ── Webview HTML ─────────────────────────────────────────────────────────────

function getWebviewContent(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ciper Chat</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            height: 100vh;
            display: flex;
            flex-direction: column;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }

        /* ── Header ── */
        #header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 7px 10px;
            border-bottom: 1px solid var(--vscode-editorGroup-border);
            background: var(--vscode-titleBar-activeBackground);
            gap: 6px;
        }
        #header h2 { font-size: 13px; font-weight: 600; white-space: nowrap; }
        #header-actions { display: flex; gap: 4px; flex-wrap: wrap; }
        .hbtn {
            background: none;
            border: 1px solid var(--vscode-button-secondaryBackground, #3a3a3a);
            color: var(--vscode-foreground);
            cursor: pointer;
            padding: 3px 7px;
            border-radius: 3px;
            font-size: 11px;
            white-space: nowrap;
        }
        .hbtn:hover { background: var(--vscode-button-secondaryHoverBackground); }

        /* ── Model badge ── */
        #model-bar {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            padding: 3px 10px;
            border-bottom: 1px solid var(--vscode-editorGroup-border);
            display: flex;
            align-items: center;
            gap: 6px;
        }
        #model-bar span { font-weight: 600; color: var(--vscode-foreground); }

        /* ── Search bar ── */
        #search-bar {
            display: none;
            padding: 6px 10px;
            border-bottom: 1px solid var(--vscode-editorGroup-border);
            gap: 6px;
        }
        #search-bar.visible { display: flex; }
        #search-input {
            flex: 1;
            padding: 4px 8px;
            background: var(--vscode-inputBox-background);
            color: var(--vscode-inputBox-foreground);
            border: 1px solid var(--vscode-inputBox-border);
            border-radius: 3px;
            font-size: 12px;
        }

        /* ── Messages ── */
        #messages {
            flex: 1;
            overflow-y: auto;
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .msg { border-radius: 6px; padding: 10px 12px; line-height: 1.6; word-break: break-word; }
        .user-msg {
            background: var(--vscode-inputValidation-infoBackground, #1a3a5c);
            border: 1px solid var(--vscode-inputValidation-infoBorder, #007acc);
            align-self: flex-end;
            max-width: 85%;
            white-space: pre-wrap;
        }
        .ai-msg {
            background: var(--vscode-editor-inactiveSelectionBackground);
            align-self: flex-start;
            max-width: 100%;
        }
        .ai-msg.streaming { border-left: 2px solid var(--vscode-progressBar-background); }

        /* ── Typing dots ── */
        .typing-dots {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 10px 14px;
        }
        .typing-dots span {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: var(--vscode-descriptionForeground);
            animation: bounce 1.2s infinite ease-in-out;
        }
        .typing-dots span:nth-child(1) { animation-delay: 0s; }
        .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
        .typing-dots span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes bounce {
            0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
            30%            { transform: translateY(-6px); opacity: 1; }
        }
        .error-msg {
            background: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            border-radius: 6px;
            padding: 10px 12px;
            white-space: pre-wrap;
            font-size: 12px;
        }

        /* ── Code blocks inside AI messages ── */
        .ai-msg pre {
            background: var(--vscode-textCodeBlock-background, #1e1e1e);
            border: 1px solid var(--vscode-editorGroup-border);
            border-radius: 4px;
            padding: 10px 12px;
            overflow-x: auto;
            margin: 6px 0;
            position: relative;
        }
        .ai-msg code { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
        .ai-msg p { margin: 4px 0; }
        .ai-msg ul, .ai-msg ol { padding-left: 18px; margin: 4px 0; }

        .copy-btn {
            position: absolute;
            top: 4px;
            right: 6px;
            font-size: 10px;
            padding: 2px 6px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
            opacity: 0.7;
        }
        .copy-btn:hover { opacity: 1; }

        /* ── Input area ── */
        #input-area {
            display: flex;
            gap: 6px;
            padding: 8px 10px;
            border-top: 1px solid var(--vscode-editorGroup-border);
        }
        #input {
            flex: 1;
            padding: 7px 10px;
            border: 1px solid var(--vscode-inputBox-border);
            background: var(--vscode-inputBox-background);
            color: var(--vscode-inputBox-foreground);
            border-radius: 4px;
            font-size: 13px;
            font-family: var(--vscode-font-family);
            resize: none;
            min-height: 36px;
            max-height: 120px;
        }
        #input:focus { outline: 1px solid var(--vscode-focusBorder); border-color: var(--vscode-focusBorder); }
        #send {
            padding: 7px 14px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            align-self: flex-end;
        }
        #send:hover { background: var(--vscode-button-hoverBackground); }
        #send:disabled { opacity: 0.4; cursor: not-allowed; }
    </style>
</head>
<body>

<div id="header">
    <h2>⚡ Ciper</h2>
    <div id="header-actions">
        <button class="hbtn" onclick="cmd('analyzeProject')" title="Scan & analyze the whole project">📁 Scan</button>
        <button class="hbtn" onclick="cmd('switchModel')">Model</button>
        <button class="hbtn" onclick="toggleSearch()">Search</button>
        <button class="hbtn" onclick="cmd('exportChat')">Export</button>
        <button class="hbtn" onclick="cmd('clearHistory')">Clear</button>
    </div>
</div>

<div id="model-bar">Model: <span id="model-name">…</span></div>

<div id="search-bar">
    <input id="search-input" placeholder="Search in history (Enter)…" />
    <button class="hbtn" onclick="doSearch()">Go</button>
    <button class="hbtn" onclick="closeSearch()">✕</button>
</div>

<div id="messages"></div>

<div id="input-area">
    <textarea id="input" rows="1" placeholder="Ask anything… (Enter = send, Shift+Enter = newline)"></textarea>
    <button id="send">Send</button>
</div>

<script>
    const vscode = acquireVsCodeApi();
    const msgsEl  = document.getElementById('messages');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send');
    const modelEl = document.getElementById('model-name');
    const searchBar = document.getElementById('search-bar');
    const searchInput = document.getElementById('search-input');

    let streaming = false;
    let currentAiEl = null;
    let typingEl = null;   // animated dots shown while waiting for first chunk
    let rawBuffer = '';    // accumulated raw markdown for current AI message

    /* ── Commands ── */
    function cmd(name) { vscode.postMessage({ command: name }); }

    function toggleSearch() {
        searchBar.classList.toggle('visible');
        if (searchBar.classList.contains('visible')) searchInput.focus();
    }
    function closeSearch() { searchBar.classList.remove('visible'); }
    function doSearch() {
        const q = searchInput.value.trim();
        if (q) cmd('searchHistory');  // delegate to extension
    }

    /* ── Markdown renderer (lightweight) ── */
    function renderMarkdown(raw) {
        // escape HTML first
        let html = raw
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // fenced code blocks
        html = html.replace(/\`\`\`(\\w*)?\\n([\\s\\S]*?)\`\`\`/g, (_, lang, code) => {
            const l = lang || '';
            return \`<pre><button class="copy-btn" onclick="copyCode(this)">Copy</button><code class="lang-\${l}">\${code}</code></pre>\`;
        });

        // inline code
        html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');

        // bold / italic
        html = html.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
        html = html.replace(/\\*([^*]+)\\*/g, '<em>$1</em>');

        // headings
        html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2>$2</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

        // unordered lists
        html = html.replace(/^[\\-\\*] (.+)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*<\\/li>)/gs, '<ul>$1</ul>');

        // ordered lists
        html = html.replace(/^\\d+\\. (.+)$/gm, '<li>$1</li>');

        // paragraphs (double newlines)
        html = html.replace(/\\n\\n/g, '</p><p>');
        html = '<p>' + html + '</p>';

        // single newlines inside paragraphs
        html = html.replace(/([^>])\\n([^<])/g, '$1<br>$2');

        return html;
    }

    function copyCode(btn) {
        const code = btn.nextElementSibling.textContent;
        navigator.clipboard.writeText(code).then(() => {
            btn.textContent = 'Copied!';
            setTimeout(() => btn.textContent = 'Copy', 1500);
        });
    }

    /* ── Message management ── */
    function addUserMsg(text) {
        const d = document.createElement('div');
        d.className = 'msg user-msg';
        d.textContent = text;
        msgsEl.appendChild(d);
        scrollBottom();
    }

    function showTypingDots() {
        typingEl = document.createElement('div');
        typingEl.className = 'msg ai-msg typing-dots';
        typingEl.innerHTML = '<span></span><span></span><span></span>';
        msgsEl.appendChild(typingEl);
        scrollBottom();
    }

    function removeTypingDots() {
        if (typingEl) { typingEl.remove(); typingEl = null; }
    }

    function startAiMsg() {
        rawBuffer = '';
        currentAiEl = document.createElement('div');
        currentAiEl.className = 'msg ai-msg streaming';
        msgsEl.appendChild(currentAiEl);
        scrollBottom();
    }

    function appendChunk(chunk) {
        // First chunk: swap typing dots for real AI bubble
        if (typingEl) {
            removeTypingDots();
            startAiMsg();
        }
        rawBuffer += chunk;
        if (currentAiEl) {
            currentAiEl.innerHTML = renderMarkdown(rawBuffer);
            scrollBottom();
        }
    }

    function finalizeAiMsg() {
        if (currentAiEl) {
            currentAiEl.innerHTML = renderMarkdown(rawBuffer);
            currentAiEl.classList.remove('streaming');
            currentAiEl = null;
            rawBuffer = '';
        }
    }

    function showError(msg) {
        const d = document.createElement('div');
        d.className = 'error-msg';
        d.textContent = msg;
        msgsEl.appendChild(d);
        scrollBottom();
    }

    function scrollBottom() { msgsEl.scrollTop = msgsEl.scrollHeight; }

    /* ── Send ── */
    function sendMessage() {
        const text = inputEl.value.trim();
        if (!text || streaming) return;
        // Lock immediately to prevent double-send before streamStart arrives
        streaming = true;
        sendBtn.disabled = true;
        addUserMsg(text);
        inputEl.value = '';
        inputEl.style.height = 'auto';
        showTypingDots();
        vscode.postMessage({ command: 'sendMessage', text });
    }

    inputEl.addEventListener('input', () => {
        inputEl.style.height = 'auto';
        inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
    });
    inputEl.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    searchInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') doSearch();
        if (e.key === 'Escape') closeSearch();
    });
    sendBtn.addEventListener('click', sendMessage);

    /* ── Messages from extension ── */
    window.addEventListener('message', e => {
        const msg = e.data;
        switch (msg.type) {
            case 'init':         modelEl.textContent = msg.model; break;
            case 'modelChanged': modelEl.textContent = msg.model; break;
            case 'streamStart':
                // streaming/sendBtn already set in sendMessage(); typing dots already shown
                // (if triggered externally via sendToPanel, set them here)
                if (!streaming) {
                    streaming = true;
                    sendBtn.disabled = true;
                    showTypingDots();
                }
                break;
            case 'streamChunk': appendChunk(msg.data); break;
            case 'streamEnd':
                streaming = false;
                sendBtn.disabled = false;
                finalizeAiMsg();
                break;
            case 'error':
                streaming = false;
                sendBtn.disabled = false;
                finalizeAiMsg();
                showError(msg.data);
                break;
            case 'clearHistory':
                msgsEl.innerHTML = '';
                break;
            case 'injectMessage':
                inputEl.value = msg.text;
                break;
        }
    });
</script>
</body>
</html>`;
}

export function deactivate() {}
