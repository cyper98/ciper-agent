import * as vscode from 'vscode';
import * as path from 'path';

let chatPanel: vscode.WebviewPanel | undefined;
let statusBar: vscode.StatusBarItem;
let currentModel = 'mistral';
let currentSessionId: string = generateSessionId();
let abortController: AbortController | undefined;
let cachedProjectContext: { data: ProjectContext; ts: number } | undefined;
const sessionProjectContext = new Map<string, ProjectContext>();
const CONTEXT_CACHE_TTL = 120_000; // 2 minutes

interface FileContext {
    language?: string;
    fileName?: string;
    selectedText?: string;
    fullContent?: string;
    projectRoot?: string;
    attachedFiles?: AttachedFile[];
    images?: string[];
}

interface AttachedFile {
    name: string;
    path: string;
    content: string;
    language: string;
}

interface ProjectContext {
    rootName: string;
    tree: string[];
    keyFiles: Record<string, string>;
}

const KEY_FILE_NAMES = [
    'package.json', 'requirements.txt', 'pyproject.toml', 'setup.py',
    'README.md', 'Dockerfile', 'docker-compose.yml',
    'tsconfig.json', '.eslintrc.json',
    'main.py', 'app.py', 'run.py', 'server.py',
    'index.ts', 'index.js', 'main.ts', 'main.js',
    'src/index.ts', 'src/main.ts', 'src/app.ts',
    'src/index.js', 'src/main.js',
];

const EXCLUDE_GLOB = '{**/node_modules/**,**/.git/**,**/venv/**,**/env/**,**/.venv/**,**/dist/**,**/out/**,**/build/**,**/__pycache__/**,**/.next/**,**/.cache/**}';
const MAX_FILE_BYTES = 4000;
const MAX_TREE_ENTRIES = 200;

function generateSessionId(): string {
    return 'chat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

export function activate(context: vscode.ExtensionContext) {
    currentSessionId = context.globalState.get<string>('ciper.currentSessionId', generateSessionId());

    statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.command = 'ciper.switchModel';
    statusBar.tooltip = 'Ciper Agent — click to switch model';
    currentModel = vscode.workspace.getConfiguration('ciper').get<string>('defaultModel', 'mistral');
    updateStatusBar();
    statusBar.show();
    context.subscriptions.push(statusBar);

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
            if (!editor) { vscode.window.showWarningMessage('Ciper: Open a file first.'); return; }
            const selected = editor.document.getText(editor.selection);
            if (!selected) { vscode.window.showWarningMessage('Ciper: Select some code first.'); return; }
            openOrRevealPanel(context);
            const fc = getFileContext(editor);
            await sendToPanel(`Please analyze this code:\n\`\`\`${fc.language}\n${selected}\n\`\`\``, fc);
        }),

        vscode.commands.registerCommand('ciper.plan', async () => {
            const input = await vscode.window.showInputBox({
                prompt: 'What do you want to plan?',
                placeHolder: 'Describe your feature or task…',
            });
            if (!input) { return; }
            openOrRevealPanel(context);
            await sendToPanel(`Create a detailed plan for: ${input}`, {});
        }),

        vscode.commands.registerCommand('ciper.switchModel', async () => {
            const models = await fetchModels();
            if (!models.length) { vscode.window.showErrorMessage('Ciper: No models found. Is Ollama running?'); return; }
            const selected = await vscode.window.showQuickPick(models, { placeHolder: `Current model: ${currentModel}` });
            if (selected) {
                currentModel = selected;
                await vscode.workspace.getConfiguration('ciper').update('defaultModel', selected, vscode.ConfigurationTarget.Global);
                updateStatusBar();
                vscode.window.showInformationMessage(`Ciper: Switched to ${selected}`);
                chatPanel?.webview.postMessage({ type: 'modelChanged', model: selected });
            }
        }),

        vscode.commands.registerCommand('ciper.clearHistory', async () => {
            try {
                await fetch(`${getBackendUrl()}/api/chat/${currentSessionId}`, { method: 'DELETE' });
                chatPanel?.webview.postMessage({ type: 'clearHistory' });
                vscode.window.showInformationMessage('Ciper: Chat history cleared.');
            } catch {
                vscode.window.showErrorMessage('Ciper: Could not clear history (backend offline?)');
            }
        }),

        vscode.commands.registerCommand('ciper.exportChat', async () => {
            try {
                const res = await fetch(`${getBackendUrl()}/api/chat/${currentSessionId}/export`);
                if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
                const markdown = await res.text();
                const uri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(`ciper-${currentSessionId}.md`),
                    filters: { Markdown: ['md'] },
                });
                if (uri) {
                    await vscode.workspace.fs.writeFile(uri, Buffer.from(markdown, 'utf8'));
                    vscode.window.showInformationMessage(`Ciper: Exported to ${uri.fsPath}`);
                    vscode.env.openExternal(uri);
                }
            } catch (e) {
                vscode.window.showErrorMessage(`Ciper: Export failed — ${e}`);
            }
        }),

        vscode.commands.registerCommand('ciper.analyzeProject', async () => {
            const ws = vscode.workspace.workspaceFolders?.[0];
            if (!ws) { vscode.window.showWarningMessage('Ciper: Open a workspace folder first.'); return; }
            openOrRevealPanel(context);
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Ciper: Scanning project…', cancellable: false },
                async () => {
                    const projectCtx = await getWorkspaceContext(true);
                    const message = `Phân tích dự án này cho tôi:\n- Mục đích và chức năng chính\n- Kiến trúc và luồng xử lý\n- Các dependencies chính\n- Điểm có thể tối ưu hoặc cải thiện`;
                    await new Promise(r => setTimeout(r, 400));
                    chatPanel?.webview.postMessage({ type: 'injectMessage', text: message });
                    await streamResponse(message, {}, chatPanel!, projectCtx);
                    vscode.window.showInformationMessage(`Ciper: Scanned ${projectCtx.tree.length} files.`);
                }
            );
        }),

        vscode.commands.registerCommand('ciper.searchHistory', async () => {
            const query = await vscode.window.showInputBox({ prompt: 'Search in chat history', placeHolder: 'Type a keyword…' });
            if (!query) { return; }
            try {
                const res = await fetch(`${getBackendUrl()}/api/chat/${currentSessionId}/search?q=${encodeURIComponent(query)}`);
                const data = await res.json() as { results: { role: string; content: string; ts: string }[]; count: number };
                if (!data.count) { vscode.window.showInformationMessage(`Ciper: No results for "${query}"`); return; }
                const items = data.results.map(r => ({
                    label: r.role === 'user' ? '$(account) You' : '$(hubot) Ciper',
                    description: r.ts,
                    detail: r.content.slice(0, 120) + (r.content.length > 120 ? '…' : ''),
                }));
                await vscode.window.showQuickPick(items, { placeHolder: `${data.count} result(s) for "${query}"`, matchOnDetail: true });
            } catch (e) {
                vscode.window.showErrorMessage(`Ciper: Search failed — ${e}`);
            }
        })

    );

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
        'Ciper',
        vscode.ViewColumn.Beside,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
        }
    );

    chatPanel.webview.html = getWebviewContent(chatPanel.webview, context);
    chatPanel.onDidDispose(() => { chatPanel = undefined; });

    chatPanel.webview.onDidReceiveMessage(async (msg) => {
        switch (msg.command) {

            // ── Webview signals it is ready — now safe to send init ──
            case 'webviewReady': {
                chatPanel?.webview.postMessage({ type: 'init', model: currentModel, sessionId: currentSessionId });
                break;
            }

            case 'sendMessage': {
                const editor = vscode.window.activeTextEditor;
                const fc: FileContext = (editor && getFileContextEnabled()) ? getFileContext(editor) : {};
                if (msg.attachedFiles?.length) { fc.attachedFiles = msg.attachedFiles; }
                if (msg.images?.length) { fc.images = msg.images; }
                const pc = vscode.workspace.workspaceFolders ? await getSessionWorkspaceContext(currentSessionId) : {};
                await streamResponse(msg.text, fc, chatPanel!, pc);
                break;
            }

            case 'stopStream': {
                abortController?.abort();
                break;
            }

            case 'continueResponse': {
                const fc: FileContext = vscode.window.activeTextEditor && getFileContextEnabled()
                    ? getFileContext(vscode.window.activeTextEditor) : {};
                const pc = vscode.workspace.workspaceFolders ? await getSessionWorkspaceContext(currentSessionId) : {};
                await streamResponse('Continue from where you left off.', fc, chatPanel!, pc);
                break;
            }

            case 'readFiles': {
                const ws = vscode.workspace.workspaceFolders?.[0];
                if (!ws) { break; }
                const paths: string[] = msg.paths || [];
                let followUp = 'Here are the file contents you requested:\n\n';
                const failed: string[] = [];
                for (const p of paths) {
                    try {
                        const uri = vscode.Uri.joinPath(ws.uri, p);
                        const bytes = await vscode.workspace.fs.readFile(uri);
                        const content = Buffer.from(bytes).toString('utf8').slice(0, 8000);
                        const ext = path.extname(p).slice(1);
                        followUp += `**${p}**\n\`\`\`${ext}\n${content}\n\`\`\`\n\n`;
                    } catch {
                        failed.push(p);
                    }
                }
                if (failed.length) { followUp += `Note: Could not read: ${failed.join(', ')}\n\n`; }
                followUp += 'Now please continue with your answer based on these files.';
                const pc2 = vscode.workspace.workspaceFolders ? await getSessionWorkspaceContext(currentSessionId) : {};
                await streamResponse(followUp, {}, chatPanel!, pc2);
                break;
            }

            case 'searchFiles': {
                const query: string = (msg.query || '').trim();
                if (!query) { break; }
                const results = await searchWorkspace(query, 30);
                let followUp = `Search results for "${query}":\n\n`;
                if (!results.length) {
                    followUp += 'No related files found. Try a broader query.\n\n';
                } else {
                    for (const r of results) {
                        followUp += `- ${r.path}`;
                        if (r.preview) {
                            followUp += `\n  Preview: ${r.preview}`;
                        }
                        followUp += '\n';
                    }
                    followUp += '\n';
                }
                followUp += 'Continue by requesting exact files with <ciper:read ... /> before editing.';
                const pc3 = vscode.workspace.workspaceFolders ? await getSessionWorkspaceContext(currentSessionId) : {};
                await streamResponse(followUp, {}, chatPanel!, pc3);
                break;
            }

            case 'applyFileOp': {
                const ws = vscode.workspace.workspaceFolders?.[0];
                if (!ws) { vscode.window.showErrorMessage('Ciper: No workspace folder open.'); break; }
                const { action, filePath, content } = msg;
                const absUri = vscode.Uri.joinPath(ws.uri, filePath);
                try {
                    if (action === 'write') {
                        const dirPath = path.posix.dirname(filePath);
                        if (dirPath && dirPath !== '.') {
                            await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(ws.uri, ...dirPath.split('/')));
                        }
                        await vscode.workspace.fs.writeFile(absUri, Buffer.from(content, 'utf8'));
                        const doc = await vscode.workspace.openTextDocument(absUri);
                        await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.One });
                        chatPanel?.webview.postMessage({ type: 'fileOpDone', filePath, success: true });
                        vscode.window.showInformationMessage(`Ciper: Created/updated ${filePath}`);
                    } else if (action === 'delete') {
                        await vscode.workspace.fs.delete(absUri);
                        chatPanel?.webview.postMessage({ type: 'fileOpDone', filePath, success: true });
                        vscode.window.showInformationMessage(`Ciper: Deleted ${filePath}`);
                    }
                } catch (e) {
                    chatPanel?.webview.postMessage({ type: 'fileOpDone', filePath, success: false });
                    vscode.window.showErrorMessage(`Ciper: File operation failed — ${e}`);
                }
                break;
            }

            case 'previewFileOp': {
                const ws = vscode.workspace.workspaceFolders?.[0];
                if (!ws) { break; }
                const { filePath, content } = msg;
                const absUri = vscode.Uri.joinPath(ws.uri, filePath);
                const tmpUri = vscode.Uri.joinPath(ws.uri, `.ciper-tmp-${Date.now()}.tmp`);
                try {
                    await vscode.workspace.fs.writeFile(tmpUri, Buffer.from(content, 'utf8'));
                    let existsOriginal = false;
                    try { await vscode.workspace.fs.stat(absUri); existsOriginal = true; } catch { /* noop */ }
                    if (existsOriginal) {
                        await vscode.commands.executeCommand('vscode.diff', absUri, tmpUri, `Diff: ${filePath} (Ciper proposed)`);
                    } else {
                        const doc = await vscode.workspace.openTextDocument(tmpUri);
                        await vscode.window.showTextDocument(doc);
                    }
                    setTimeout(async () => { try { await vscode.workspace.fs.delete(tmpUri); } catch { /* noop */ } }, 60000);
                } catch (e) {
                    vscode.window.showErrorMessage(`Ciper: Preview failed — ${e}`);
                }
                break;
            }

            case 'attachFile': {
                const uris = await vscode.window.showOpenDialog({
                    canSelectMany: true, canSelectFiles: true, canSelectFolders: false, openLabel: 'Attach to Chat',
                });
                if (!uris?.length) { break; }
                const files: AttachedFile[] = [];
                for (const uri of uris) {
                    try {
                        const bytes = await vscode.workspace.fs.readFile(uri);
                        const content = Buffer.from(bytes).toString('utf8').slice(0, 8000);
                        const ext = path.extname(uri.fsPath).slice(1);
                        files.push({ name: path.basename(uri.fsPath), path: vscode.workspace.asRelativePath(uri), content, language: ext });
                    } catch { /* noop */ }
                }
                chatPanel?.webview.postMessage({ type: 'filesAttached', files });
                break;
            }

            case 'loadHistory': {
                try {
                    const res = await fetch(`${getBackendUrl()}/api/chat/${currentSessionId}/history`);
                    if (res.ok) {
                        const data = await res.json() as { messages: { role: string; content: string; ts: string }[] };
                        chatPanel?.webview.postMessage({ type: 'historyLoaded', messages: data.messages, sessionId: currentSessionId });
                    } else {
                        chatPanel?.webview.postMessage({ type: 'historyLoaded', messages: [], sessionId: currentSessionId });
                    }
                } catch {
                    chatPanel?.webview.postMessage({ type: 'historyLoaded', messages: [], sessionId: currentSessionId });
                }
                try {
                    const sres = await fetch(`${getBackendUrl()}/api/sessions`);
                    const sdata = sres.ok
                        ? await sres.json() as { sessions: { session: string; count: number; last_active: string; first_message?: string }[] }
                        : { sessions: [] };
                    chatPanel?.webview.postMessage({ type: 'sessionsLoaded', sessions: sdata.sessions, currentSessionId });
                } catch {
                    chatPanel?.webview.postMessage({ type: 'sessionsLoaded', sessions: [], currentSessionId });
                }
                break;
            }

            case 'loadSessions': {
                try {
                    const res = await fetch(`${getBackendUrl()}/api/sessions`);
                    const data = res.ok
                        ? await res.json() as { sessions: { session: string; count: number; last_active: string; first_message?: string }[] }
                        : { sessions: [] };
                    chatPanel?.webview.postMessage({ type: 'sessionsLoaded', sessions: data.sessions, currentSessionId });
                } catch {
                    chatPanel?.webview.postMessage({ type: 'sessionsLoaded', sessions: [], currentSessionId });
                }
                break;
            }

            case 'switchSession': {
                currentSessionId = msg.sessionId;
                context.globalState.update('ciper.currentSessionId', currentSessionId);
                try {
                    const res = await fetch(`${getBackendUrl()}/api/chat/${currentSessionId}/history`);
                    const data = res.ok
                        ? await res.json() as { messages: { role: string; content: string; ts: string }[] }
                        : { messages: [] };
                    chatPanel?.webview.postMessage({ type: 'historyLoaded', messages: data.messages, sessionId: currentSessionId });
                } catch {
                    chatPanel?.webview.postMessage({ type: 'historyLoaded', messages: [], sessionId: currentSessionId });
                }
                break;
            }

            case 'newSession': {
                currentSessionId = generateSessionId();
                sessionProjectContext.delete(currentSessionId);
                context.globalState.update('ciper.currentSessionId', currentSessionId);
                chatPanel?.webview.postMessage({ type: 'newSessionCreated', sessionId: currentSessionId });
                break;
            }

            case 'deleteSession': {
                try {
                    await fetch(`${getBackendUrl()}/api/chat/${msg.sessionId}`, { method: 'DELETE' });
                    sessionProjectContext.delete(msg.sessionId);
                    if (msg.sessionId === currentSessionId) {
                        currentSessionId = generateSessionId();
                        context.globalState.update('ciper.currentSessionId', currentSessionId);
                    }
                    chatPanel?.webview.postMessage({ type: 'sessionDeleted', sessionId: msg.sessionId, newCurrentSessionId: currentSessionId });
                } catch { /* noop */ }
                break;
            }

            case 'analyzeProject': await vscode.commands.executeCommand('ciper.analyzeProject'); break;
            case 'switchModel':    await vscode.commands.executeCommand('ciper.switchModel');    break;
            case 'clearHistory':   await vscode.commands.executeCommand('ciper.clearHistory');   break;
            case 'exportChat':     await vscode.commands.executeCommand('ciper.exportChat');     break;
            case 'searchHistory':  await vscode.commands.executeCommand('ciper.searchHistory');  break;
        }
    });

    // Proactive init fallback: if webviewReady handshake is missed, UI still becomes usable.
    setTimeout(() => {
        chatPanel?.webview.postMessage({ type: 'init', model: currentModel, sessionId: currentSessionId });
    }, 80);

    // NOTE: Do NOT postMessage here — webview is not ready yet.
    // The webview will send 'webviewReady' when its JS has loaded.
}

async function sendToPanel(message: string, fileContext: FileContext) {
    await new Promise(r => setTimeout(r, 300));
    chatPanel?.webview.postMessage({ type: 'injectMessage', text: message });
    const pc = vscode.workspace.workspaceFolders ? await getSessionWorkspaceContext(currentSessionId) : {};
    await streamResponse(message, fileContext, chatPanel!, pc);
}

// ── Backend Communication ────────────────────────────────────────────────────

async function streamResponse(
    message: string,
    fileContext: FileContext | object,
    panel: vscode.WebviewPanel,
    projectContext: ProjectContext | object = {}
) {
    abortController = new AbortController();
    panel.webview.postMessage({ type: 'streamStart' });

    try {
        const response = await fetch(`${getBackendUrl()}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: abortController.signal,
            body: JSON.stringify({
                model: getCurrentModel(),
                message,
                session_id: currentSessionId,
                temperature: getTemperature(),
                file_context: fileContext,
                project_context: projectContext,
            }),
        });

        if (!response.ok) { throw new Error(`HTTP ${response.status}`); }

        if (response.body) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            while (true) {
                const { done, value } = await reader.read();
                if (done) { break; }
                panel.webview.postMessage({ type: 'streamChunk', data: decoder.decode(value) });
            }
        }
    } catch (error: unknown) {
        const err = error as { name?: string };
        if (err?.name === 'AbortError') {
            panel.webview.postMessage({ type: 'streamAborted' });
        } else {
            panel.webview.postMessage({
                type: 'error',
                data: `Failed to reach backend: ${error}\n\nMake sure backend is running:\n  cd backend && python main.py`,
            });
        }
    }

    panel.webview.postMessage({ type: 'streamEnd' });
    abortController = undefined;
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

async function searchWorkspace(query: string, maxResults = 30): Promise<Array<{ path: string; preview: string }>> {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) { return []; }

    const q = query.toLowerCase();
    const uris = await vscode.workspace.findFiles('**/*', EXCLUDE_GLOB, 500);
    const results: Array<{ path: string; preview: string }> = [];

    for (const uri of uris) {
        if (results.length >= maxResults) { break; }
        const rel = vscode.workspace.asRelativePath(uri);
        if (rel.toLowerCase().includes(q)) {
            results.push({ path: rel, preview: 'Matched by file path' });
            continue;
        }
        try {
            const bytes = await vscode.workspace.fs.readFile(uri);
            const text = Buffer.from(bytes).toString('utf8').slice(0, 8000);
            const idx = text.toLowerCase().indexOf(q);
            if (idx >= 0) {
                const start = Math.max(0, idx - 60);
                const end = Math.min(text.length, idx + q.length + 60);
                const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
                results.push({ path: rel, preview: snippet });
            }
        } catch {
            // Skip binary/unreadable files.
        }
    }

    return results;
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

async function getWorkspaceContext(forceRefresh = false): Promise<ProjectContext> {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) { return { rootName: '', tree: [], keyFiles: {} }; }

    const now = Date.now();
    if (!forceRefresh && cachedProjectContext && (now - cachedProjectContext.ts) < CONTEXT_CACHE_TTL) {
        return cachedProjectContext.data;
    }

    const uris = await vscode.workspace.findFiles('**/*', EXCLUDE_GLOB, MAX_TREE_ENTRIES);
    const tree = uris.map(u => vscode.workspace.asRelativePath(u)).sort();

    const keyFiles: Record<string, string> = {};
    for (const name of KEY_FILE_NAMES) {
        try {
            const uri = vscode.Uri.joinPath(ws.uri, name);
            const bytes = await vscode.workspace.fs.readFile(uri);
            const text = Buffer.from(bytes).toString('utf8');
            keyFiles[name] = text.length > MAX_FILE_BYTES ? text.slice(0, MAX_FILE_BYTES) + '\n…(truncated)' : text;
        } catch { /* file doesn't exist */ }
    }

    const data: ProjectContext = { rootName: ws.name, tree, keyFiles };
    cachedProjectContext = { data, ts: now };
    return data;
}

async function getSessionWorkspaceContext(sessionId: string, forceRefresh = false): Promise<ProjectContext> {
    if (!forceRefresh && sessionProjectContext.has(sessionId)) {
        return sessionProjectContext.get(sessionId)!;
    }
    const ctx = await getWorkspaceContext(forceRefresh);
    sessionProjectContext.set(sessionId, ctx);
    return ctx;
}

function updateStatusBar() {
    statusBar.text = `$(hubot) ${currentModel}`;
}

// ── Webview HTML ─────────────────────────────────────────────────────────────
function getWebviewContent(webview: vscode.Webview, context: vscode.ExtensionContext): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'webview.js'));
    const csp = webview.cspSource;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src ${csp}; img-src data: blob: ${csp}; connect-src http://localhost:* http://127.0.0.1:*;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Ciper</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);height:100vh;display:flex;flex-direction:column;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);overflow:hidden}
.view{display:none;flex-direction:column;flex:1;overflow:hidden;min-height:0}
.view.active{display:flex}
/* header */
.vhdr{display:flex;align-items:center;gap:6px;flex-shrink:0;padding:7px 10px;border-bottom:1px solid var(--vscode-editorGroup-border);background:var(--vscode-titleBar-activeBackground)}
.vhdr h2{font-size:13px;font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ibtn{background:none;border:none;color:var(--vscode-foreground);cursor:pointer;font-size:16px;padding:2px 6px;border-radius:3px;line-height:1;flex-shrink:0}
.ibtn:hover{background:var(--vscode-button-secondaryHoverBackground)}
.tbtn{background:none;border:1px solid var(--vscode-button-secondaryBackground,#3a3a3a);color:var(--vscode-foreground);cursor:pointer;padding:3px 8px;border-radius:3px;font-size:11px;white-space:nowrap;flex-shrink:0}
.tbtn:hover{background:var(--vscode-button-secondaryHoverBackground)}
.pbtn{padding:4px 10px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;cursor:pointer;font-size:12px;font-weight:500;flex-shrink:0}
.pbtn:hover{background:var(--vscode-button-hoverBackground)}
/* session list */
#sl{flex:1;overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:5px}
.sc{display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--vscode-editorGroup-border);border-radius:6px;cursor:pointer;background:var(--vscode-editor-background)}
.sc:hover{background:var(--vscode-list-hoverBackground)}
.sc.active{border-color:var(--vscode-focusBorder)}
.si{flex:1;min-width:0}
.sn{font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sm{font-size:11px;color:var(--vscode-descriptionForeground);margin-top:2px}
.sp{font-size:11px;color:var(--vscode-descriptionForeground);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sd{background:none;border:none;color:var(--vscode-descriptionForeground);cursor:pointer;font-size:14px;padding:2px 5px;border-radius:3px;opacity:.5;flex-shrink:0}
.sd:hover{opacity:1;color:#e05252}
.no-s{text-align:center;color:var(--vscode-descriptionForeground);padding:40px 20px;font-size:12px}
/* model bar */
#mb{font-size:11px;color:var(--vscode-descriptionForeground);padding:3px 10px;border-bottom:1px solid var(--vscode-editorGroup-border);display:flex;align-items:center;gap:6px;flex-shrink:0}
#mb span{font-weight:600;color:var(--vscode-foreground)}
/* search bar */
#sb{display:none;padding:6px 10px;border-bottom:1px solid var(--vscode-editorGroup-border);gap:6px;flex-shrink:0}
#sb.open{display:flex}
#si{flex:1;padding:4px 8px;background:var(--vscode-inputBox-background);color:var(--vscode-inputBox-foreground);border:1px solid var(--vscode-inputBox-border);border-radius:3px;font-size:12px}
/* messages */
#msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px;min-height:0}
.msg{border-radius:6px;padding:10px 12px;line-height:1.6;word-break:break-word}
.um{background:var(--vscode-inputValidation-infoBackground,#1a3a5c);border:1px solid var(--vscode-inputValidation-infoBorder,#007acc);align-self:flex-end;max-width:88%;white-space:pre-wrap}
.uimg{max-width:200px;max-height:150px;border-radius:4px;margin-top:6px;display:block}
.am{background:var(--vscode-editor-inactiveSelectionBackground);align-self:flex-start;max-width:100%}
.am.streaming{border-left:2px solid var(--vscode-progressBar-background)}
.td{display:flex;align-items:center;gap:4px;padding:10px 14px}
.td span{width:7px;height:7px;border-radius:50%;background:var(--vscode-descriptionForeground);animation:bounce 1.2s infinite ease-in-out}
.td span:nth-child(1){animation-delay:0s}
.td span:nth-child(2){animation-delay:.2s}
.td span:nth-child(3){animation-delay:.4s}
@keyframes bounce{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-6px);opacity:1}}
.em{background:var(--vscode-inputValidation-errorBackground);border:1px solid var(--vscode-inputValidation-errorBorder);border-radius:6px;padding:10px 12px;white-space:pre-wrap;font-size:12px}
.abm{color:var(--vscode-descriptionForeground);font-size:11px;font-style:italic;padding:2px 10px;align-self:center}
/* markdown */
.am pre{background:var(--vscode-textCodeBlock-background,#1e1e1e);border:1px solid var(--vscode-editorGroup-border);border-radius:4px;padding:10px 12px;overflow-x:auto;margin:6px 0;position:relative}
.am code{font-family:var(--vscode-editor-font-family,monospace);font-size:12px}
.am p{margin:4px 0}
.am ul,.am ol{padding-left:18px;margin:4px 0}
.am h1,.am h2,.am h3{margin:8px 0 4px}
.cpb{position:absolute;top:4px;right:6px;font-size:10px;padding:2px 6px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:none;border-radius:3px;cursor:pointer;opacity:.7}
.cpb:hover{opacity:1}
/* file op */
.foc{background:var(--vscode-editor-background);border:1px solid var(--vscode-focusBorder);border-radius:6px;margin:8px 0;overflow:hidden}
.foh{display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--vscode-titleBar-activeBackground);border-bottom:1px solid var(--vscode-editorGroup-border)}
.fop{font-family:var(--vscode-editor-font-family,monospace);font-size:12px;flex:1}
.fob{font-size:10px;padding:1px 6px;border-radius:3px;font-weight:600}
.fob.cr{background:#1a4a1a;color:#4ec94e;border:1px solid #4ec94e}
.fob.dl{background:#4a1a1a;color:#e05252;border:1px solid #e05252}
.fopre{max-height:200px;overflow-y:auto;background:var(--vscode-textCodeBlock-background,#1e1e1e);border-bottom:1px solid var(--vscode-editorGroup-border)}
.fopre code{font-size:11px;padding:8px 10px;display:block;white-space:pre;font-family:var(--vscode-editor-font-family,monospace)}
.foa{display:flex;gap:6px;padding:7px 10px}
.foa-ok{padding:3px 10px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;cursor:pointer;font-size:11px;font-weight:600}
.foa-ok:hover{background:var(--vscode-button-hoverBackground)}
.foa-ok:disabled{opacity:.5;cursor:not-allowed}
.foa-df{padding:3px 10px;background:none;border:1px solid var(--vscode-button-secondaryBackground,#555);color:var(--vscode-foreground);border-radius:3px;cursor:pointer;font-size:11px}
.foa-df:hover{background:var(--vscode-button-secondaryHoverBackground)}
.foa-no{padding:3px 10px;background:none;border:1px solid #663;color:var(--vscode-descriptionForeground);border-radius:3px;cursor:pointer;font-size:11px}
.foa-no:hover{background:#332200}
.fod{padding:6px 10px;font-size:11px;color:#4ec94e}
.for{padding:6px 10px;font-size:11px;color:var(--vscode-descriptionForeground);text-decoration:line-through}
/* file read */
.frc{background:var(--vscode-editor-background);border:1px solid #007acc;border-radius:6px;margin:6px 0;padding:10px 12px}
.frc h4{font-size:12px;margin-bottom:6px;color:#4fc1ff}
.frc ul{font-size:11px;padding-left:16px;margin-bottom:8px;font-family:var(--vscode-editor-font-family,monospace)}
.frc li{margin:2px 0}
.frca{display:flex;gap:6px}
.frc-ok{padding:3px 10px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;cursor:pointer;font-size:11px;font-weight:600}
.frc-ok:hover{background:var(--vscode-button-hoverBackground)}
.frc-no{padding:3px 10px;background:none;border:1px solid #663;color:var(--vscode-descriptionForeground);border-radius:3px;cursor:pointer;font-size:11px}
.frc-no:hover{background:#332200}
/* continue */
.cnb{align-self:center;margin:2px 0;padding:4px 16px;background:none;border:1px solid var(--vscode-button-secondaryBackground,#555);color:var(--vscode-foreground);border-radius:3px;cursor:pointer;font-size:11px}
.cnb:hover{background:var(--vscode-button-secondaryHoverBackground)}
/* image+attach bars */
#imgb,#attb{display:none;flex-wrap:wrap;gap:5px;padding:5px 10px;flex-shrink:0;border-top:1px solid var(--vscode-editorGroup-border);background:var(--vscode-editor-background)}
#imgb.open,#attb.open{display:flex;align-items:center}
.iw{position:relative;display:inline-block}
.it{width:48px;height:48px;object-fit:cover;border-radius:4px;border:1px solid var(--vscode-editorGroup-border)}
.ir{position:absolute;top:-5px;right:-5px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:50%;width:16px;height:16px;font-size:10px;cursor:pointer;text-align:center;line-height:16px}
.ach{display:flex;align-items:center;gap:4px;background:var(--vscode-editor-inactiveSelectionBackground);border:1px solid var(--vscode-editorGroup-border);border-radius:3px;padding:2px 7px;font-size:11px}
.acr{background:none;border:none;color:var(--vscode-descriptionForeground);cursor:pointer;font-size:12px;line-height:1;padding:0 0 0 3px}
.acr:hover{color:var(--vscode-foreground)}
/* input area */
#ia{display:flex;gap:6px;padding:8px 10px;border-top:1px solid var(--vscode-editorGroup-border);flex-shrink:0}
#atb{padding:6px 9px;background:none;border:1px solid var(--vscode-button-secondaryBackground,#3a3a3a);color:var(--vscode-foreground);border-radius:4px;cursor:pointer;font-size:14px;align-self:flex-end}
#atb:hover{background:var(--vscode-button-secondaryHoverBackground)}
#ci{flex:1;padding:7px 10px;border:1px solid var(--vscode-inputBox-border);background:var(--vscode-inputBox-background);color:var(--vscode-inputBox-foreground);border-radius:4px;font-size:13px;font-family:var(--vscode-font-family);resize:none;min-height:36px;max-height:120px}
#ci:focus{outline:1px solid var(--vscode-focusBorder);border-color:var(--vscode-focusBorder)}
#stpb{display:none;padding:7px 12px;background:#6b1a1a;color:#ff8080;border:1px solid #9b2a2a;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;align-self:flex-end}
#stpb:hover{background:#8b2222}
#sndb{padding:7px 14px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:500;align-self:flex-end}
#sndb:hover{background:var(--vscode-button-hoverBackground)}
#sndb:disabled{opacity:.4;cursor:not-allowed}
</style>
</head>
<body>

<!-- SESSION LIST VIEW -->
<div id="v-s" class="view">
  <div class="vhdr">
    <h2>⚡ Ciper — Chats</h2>
    <button id="new-s-btn" class="pbtn">+ New Chat</button>
  </div>
  <div id="sl"><div class="no-s">Loading…</div></div>
</div>

<!-- CHAT VIEW -->
<div id="v-c" class="view active">
  <div class="vhdr">
    <button id="back-btn" class="ibtn" title="All chats">☰</button>
    <h2 id="ct">⚡ Ciper</h2>
    <button id="btn-mdl"  class="tbtn">Model</button>
    <button id="btn-srch" class="tbtn">Search</button>
    <button id="btn-exp"  class="tbtn">Export</button>
    <button id="btn-clr"  class="tbtn">Clear</button>
  </div>
  <div id="mb">Model: <span id="mn">…</span></div>
  <div id="sb">
    <input id="si" placeholder="Search in history…" />
    <button id="sg-btn" class="tbtn">Go</button>
    <button id="sc-btn" class="tbtn">✕</button>
  </div>
  <div id="msgs"></div>
  <div id="imgb"></div>
  <div id="attb"></div>
  <div id="ia">
    <button id="atb" title="Attach file">📎</button>
    <textarea id="ci" rows="1" placeholder="Ask anything… (Enter = send, Shift+Enter = newline, paste image)"></textarea>
    <button id="stpb">■ Stop</button>
    <button id="sndb">Send</button>
  </div>
</div>

<script src="${scriptUri}"></script>
</body>
</html>`;
}

export function deactivate() {}
