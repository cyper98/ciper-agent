import * as vscode from 'vscode';
import { OllamaClient } from './llm/OllamaClient';
import { ModelManager } from './llm/ModelManager';
import { AgentRunner } from './agent/AgentRunner';
import { ToolExecutor } from './tools/ToolExecutor';
import { ReadFileTool } from './tools/ReadFileTool';
import { WriteFileTool } from './tools/WriteFileTool';
import { EditFileTool } from './tools/EditFileTool';
import { ListFilesTool } from './tools/ListFilesTool';
import { SearchCodeTool } from './tools/SearchCodeTool';
import { RunCommandTool } from './tools/RunCommandTool';
import { DiffEngine } from './diff/DiffEngine';
import { DiffApplier } from './diff/DiffApplier';
import { DiffPreviewProvider } from './diff/DiffPreviewProvider';
import { WebviewManager } from './webview/WebviewManager';
import { MessageBridge } from './webview/MessageBridge';
import { InlineCompletionProvider } from './completion/InlineCompletionProvider';
import { PathGuard } from './security/PathGuard';

let agentRunner: AgentRunner | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  console.log('Ciper Agent: activating...');

  // Workspace root
  const workspaceRoot =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

  const requireApproval = vscode.workspace
    .getConfiguration('ciperAgent')
    .get<boolean>('requireApprovalForEdits', true);

  // --- Infrastructure ---
  const ollamaEndpoint = vscode.workspace
    .getConfiguration('ciperAgent')
    .get<string>('ollamaEndpoint', 'http://localhost:11434');

  const ollamaClient = new OllamaClient(ollamaEndpoint);
  const modelManager = new ModelManager(ollamaClient, context);
  const pathGuard = new PathGuard(workspaceRoot);
  const diffEngine = new DiffEngine();
  const diffApplier = new DiffApplier(diffEngine);

  // --- Webview ---
  const webviewManager = new WebviewManager(context);

  const bridge = new MessageBridge(
    null as unknown as AgentRunner,
    modelManager,
    webviewManager,
    context
  );

  // Register bridge BEFORE the view provider so it is wired up the moment
  // resolveWebviewView fires (avoids any READY race condition).
  webviewManager.setBridge(bridge);

  // --- Tools ---
  const writeFileTool = new WriteFileTool(
    workspaceRoot,
    pathGuard,
    diffEngine,
    diffApplier,
    bridge,
    requireApproval
  );

  const editFileTool = new EditFileTool(
    workspaceRoot,
    pathGuard,
    diffApplier,
    diffEngine,
    bridge,
    requireApproval
  );

  const toolExecutor = new ToolExecutor({
    readFile: new ReadFileTool(workspaceRoot, pathGuard),
    writeFile: writeFileTool,
    editFile: editFileTool,
    listFiles: new ListFilesTool(workspaceRoot, pathGuard),
    searchCode: new SearchCodeTool(workspaceRoot),
    runCommand: new RunCommandTool(workspaceRoot),
  });

  // --- Agent Runner ---
  agentRunner = new AgentRunner(
    ollamaClient,
    modelManager,
    toolExecutor,
    bridge,
    workspaceRoot
  );

  // Now wire the agent runner into the bridge (resolves circular dependency)
  bridge.setAgentRunner(agentRunner);

  // --- Diff Preview Provider ---
  const diffPreviewProvider = new DiffPreviewProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      DiffPreviewProvider.SCHEME,
      diffPreviewProvider
    )
  );

  // --- Register Webview View Provider ---
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      WebviewManager.VIEW_TYPE,
      webviewManager,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // bridge is already wired via webviewManager.setBridge() above

  // --- Register Commands ---
  context.subscriptions.push(
    vscode.commands.registerCommand('ciper.chat.open', () => {
      vscode.commands.executeCommand('ciper.chatView.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ciper.agent.ask', async () => {
      const editor = vscode.window.activeTextEditor;
      const selectedText = editor?.document.getText(editor.selection);
      const placeholder = selectedText
        ? `Ask about the selected code...`
        : `Ask Ciper Agent anything...`;

      const input = await vscode.window.showInputBox({
        prompt: 'What would you like Ciper to do?',
        placeHolder: placeholder,
        ignoreFocusOut: true,
      });

      if (input) {
        await vscode.commands.executeCommand('ciper.chatView.focus');
        // Show the user message in the chat UI, then run the agent
        webviewManager.send({
          kind: 'INJECT_USER_MESSAGE',
          content: input,
          mode: 'agent',
        });
        await agentRunner?.runAgent(input);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ciper.agent.fix', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const line = editor.document.lineAt(editor.selection.active.line).text;
      const prompt = `Fix this code: ${line}`;

      await vscode.commands.executeCommand('ciper.chatView.focus');
      await agentRunner?.runAgent(prompt);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ciper.agent.stop', () => {
      agentRunner?.cancel();
    })
  );

  // --- Register Inline Completion Provider ---
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(
      { scheme: 'file' },
      new InlineCompletionProvider(ollamaClient, modelManager)
    )
  );

  // --- Set context for menu visibility ---
  vscode.commands.executeCommand('setContext', 'ciper.agentRunning', false);

  // Initialize models (non-blocking, but push to webview once done)
  modelManager.initialize().then(() => {
    // Push updated model list to the webview in case it was already open
    // when initialization completed (resolves the race with READY)
    modelManager.sendModelsTo(bridge);
  }).catch(err => {
    console.error('Ciper Agent: model init failed', err);
  });

  console.log('Ciper Agent: activated');
}

export function deactivate(): void {
  agentRunner?.cancel();
  console.log('Ciper Agent: deactivated');
}
