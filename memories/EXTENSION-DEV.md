# VS Code Extension Development Guide - Quick Reference

## 📋 Table of Contents
1. [Extension Essentials](#extension-essentials)
2. [Development Setup](#development-setup)
3. [Common Commands](#common-commands)
4. [VS Code API Cheatsheet](#vs-code-api-cheatsheet)
5. [Debugging Tips](#debugging-tips)
6. [Publishing Workflow](#publishing-workflow)

---

## Extension Essentials

### What is a VS Code Extension?
- A VS Code Extension mở rộng chức năng của editor
- Chạy trong một host process riêng biệt (for security)
- Viết bằng TypeScript/JavaScript
- Có thể tương tác với file, editor, settings, commands

### Extension Anatomy
```
extension/
├── src/
│   ├── extension.ts       # Entry point (exported activate/deactivate)
│   └── views/
│       └── chat-panel.ts  # Webview logic
├── media/
│   └── style.css          # Styles cho webview
├── package.json           # Manifest + metadata
├── tsconfig.json          # TypeScript config
└── webpack.config.js      # Build bundler
```

---

## Development Setup

### Prerequisites
```bash
# Install Node.js (v14+) from nodejs.org
node --version  # Should output v14+

# Install global tools
npm install -g @vscode/generator-code  # For scaffolding
npm install -g @vscode/vsce             # For publishing
npm install -g typescript webpack webpack-cli
```

### Project Init
```bash
# Generate extension from template
cd /Users/seang/Downloads/dev/ciper-agent
yo code

# Choose:
# - TypeScript
# - ESM vs CommonJS: ESM (recommended)
# - Use webview UI: Yes
# - Setup linting: Yes
```

### Install Dependencies
```bash
cd extension
npm install

# Add React for webview UI
npm install react react-dom
npm install -D @types/react

# Add webpack for bundling
npm install -D webpack webpack-cli ts-loader
```

---

## Common Commands

### Development
```bash
# Watch mode - auto-recompile on file change
npm run watch

# Compile once
npm run compile

# Debug build
npm run compile -- --development

# Run tests
npm test
```

### Debugging
```bash
# In VS Code:
# 1. Press F5 to launch Extension Development Host
# 2. Opens new VS Code window with your extension
# 3. Set breakpoints in src/ files
# 4. Use Debug Console to run commands
```

### Packaging
```bash
# Test packaging
vsce ls

# Create .vsix file (for manual testing)
vsce package

# Publish to marketplace
vsce publish minor  # Bumps version automatically
vsce publish       # Use existing version in package.json
```

---

## VS Code API Cheatsheet

### Active Text Editor
```typescript
import * as vscode from 'vscode';

// Get current editor
const editor = vscode.window.activeTextEditor;

// Get file info
const document = editor.document;
const fileName = document.fileName;
const languageId = document.languageId;
const uri = document.uri;

// Get text
const allText = document.getText();
const selectedText = document.getText(editor.selection);
const lineText = document.lineAt(editor.selection.active.line).text;

// Get cursor position
const line = editor.selection.active.line;
const column = editor.selection.active.character;
```

### File System
```typescript
// Read file
const fileUri = vscode.Uri.file('/path/to/file.ts');
const data = await vscode.workspace.fs.readFile(fileUri);
const content = data.toString();

// Write file
const newData = new TextEncoder().encode('content');
await vscode.workspace.fs.writeFile(fileUri, newData);

// Watch file changes
const watcher = vscode.workspace.createFileSystemWatcher('**/*.ts');
watcher.onDidChange(uri => console.log('Changed:', uri));
```

### Commands
```typescript
// Register command
const disposable = vscode.commands.registerCommand('ciper.chat', async () => {
  await vscode.window.showInformationMessage('Hello!');
});
context.subscriptions.push(disposable);

// Execute command
await vscode.commands.executeCommand('extension.myCommand', arg1, arg2);

// Common built-in commands
vscode.commands.executeCommand('editor.action.formatDocument');
vscode.commands.executeCommand('workbench.action.quickOpen', 'file_query');
vscode.commands.executeCommand('vscode.open', uri);
```

### UI Notifications
```typescript
// Message boxes
await vscode.window.showInformationMessage('Info');
await vscode.window.showWarningMessage('Warning');
await vscode.window.showErrorMessage('Error');

// With actions
const result = await vscode.window.showQuickPick(
  ['Option A', 'Option B', 'Option C'],
  { placeHolder: 'Choose one' }
);

// Input box
const input = await vscode.window.showInputBox({
  prompt: 'Enter model name',
  placeHolder: 'mistral'
});
```

### Status Bar
```typescript
// Create status bar item
const statusBar = vscode.window.createStatusBarItem(
  vscode.StatusBarAlignment.Right,  // Right or Left
  100                               // Priority
);

statusBar.command = 'ciper.switchModel';
statusBar.text = '$(hubot) Mistral';
statusBar.tooltip = 'Click to switch model';
statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
statusBar.show();

// Dispose when done
statusBar.dispose();
```

### Webview Panel
```typescript
// Create webview
const panel = vscode.window.createWebviewPanel(
  'ciperChat',           // ID
  'Ciper Chat',          // Title
  vscode.ViewColumn.Two, // Column
  {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [
      vscode.Uri.file(path.join(extensionUri.fsPath, 'media'))
    ]
  }
);

// Set HTML content
panel.webview.html = `
  <!DOCTYPE html>
  <html>
    <body>
      <h1>Hello from Webview</h1>
      <script src="${nonce}"></script>
    </body>
  </html>
`;

// Receive messages from webview
panel.webview.onDidReceiveMessage(message => {
  if (message.command === 'alert') {
    vscode.window.showInformationMessage(message.text);
  }
});

// Send message to webview
panel.webview.postMessage({
  type: 'MODEL_CHANGED',
  model: 'mistral'
});

// Handle close
panel.onDidDispose(() => {
  console.log('Panel closed');
});
```

### Configuration (Settings)
```typescript
// Get config
const config = vscode.workspace.getConfiguration('ciper');
const apiUrl = config.get('backend.url');
const model = config.get('defaultModel');

// Update config (global)
await config.update(
  'defaultModel',
  'mistral',
  vscode.ConfigurationTarget.Global
);

// Listen to config changes
vscode.workspace.onDidChangeConfiguration(event => {
  if (event.affectsConfiguration('ciper.defaultModel')) {
    console.log('Model changed!');
  }
});
```

### Global State (Extension-specific storage)
```typescript
// Get value
const lastModel = context.globalState.get('lastModel');

// Set value
await context.globalState.update('lastModel', 'mistral');

// Get workspace state (per folder)
const wsValue = context.workspaceState.get('someKey');
```

---

## Debugging Tips

### Enable Debug Logging
```typescript
// In extension.ts
const console = {
  log: (...args: any[]) => {
    vscode.window.showInformationMessage(args.join(' '));
  }
};
```

### Use Debug Console
```bash
# While debugging (F5):
# Open Debug Console (View → Debug Console)
# Type: DEBUG('your message')
```

### Common Debug Points
```typescript
// At extension activation
export function activate(context: vscode.ExtensionContext) {
  console.log('Extension "ciper-agent" is now active!');
  // Set breakpoint here with F9
}

// Before external API calls
vscode.window.showInformationMessage('Calling: ' + apiUrl);

// After catching errors
catch (error) {
  vscode.window.showErrorMessage('Error: ' + error.message);
}
```

### Network Debugging
```bash
# Use curl to test backend
curl -X POST http://localhost:8000/api/health \
  -H "Content-Type: application/json"

# Log fetch requests in webview
fetch(url).then(r => {
  console.log('Response:', r);
  return r.text();
});
```

---

## Publishing Workflow

### Pre-Publish
```bash
# 1. Update version in package.json
# 2. Update CHANGELOG.md
# 3. Compile and test
npm run compile
npm test

# 4. Create .vsix locally to test
vsce package

# 5. Test install
code --install-extension ciper-agent-0.1.0.vsix
```

### Marketplace Setup
1. Go to https://marketplace.visualstudio.com/
2. Sign in with Microsoft account
3. Start → Create Publisher (one-time)
4. Get Personal Access Token (PAT)

### Publish
```bash
# First time: create publisher
vsce create-publisher ciper

# Publish update
vsce publish patch   # 0.1.0 → 0.1.1
vsce publish minor   # 0.1.0 → 0.2.0
vsce publish major   # 0.1.0 → 1.0.0

# Publish without version bump
vsce publish
```

### Post-Publish
- [ ] Check marketplace listing
- [ ] Test install from marketplace
- [ ] Create GitHub release with notes
- [ ] Announce on social media
- [ ] Monitor ratings & feedback

---

## Quick Reference - Folder Structure

### extension/ (TypeScript/React)
```
src/
├── extension.ts              # Activation + commands
├── views/
│   ├── chat-panel.ts        # Webview class
│   └── components/
│       ├── Chat.tsx         # React components
│       └── Model.tsx
├── providers/
│   ├── code-lens.ts         # Inline hints
│   └── hover.ts             # Hover info
└── utils/
    ├── api-client.ts        # Backend calls
    └── storage.ts           # Global state

media/
├── index.html               # Webview HTML
├── style.css               # Styles
└── script.js               # Webview script
```

### Key Files
- **package.json** - Extension manifest (commands, config, dependencies)
- **tsconfig.json** - TypeScript compiler settings
- **webpack.config.js** - Bundler configuration
- **CHANGELOG.md** - Release notes

---

## Common Mistakes to Avoid

❌ **Don't**
- Put async logic in activate without awaiting
- Hardcode absolute paths
- Make blocking operations in UI thread
- Forget to dispose resources

✅ **Do**
- Use VS Code API for everything file-related
- Make long operations async
- Return disposables from event listeners
- Test your extension thoroughly

---

## Resources

- [VS Code Extension API](https://code.visualstudio.com/api)
- [Extension Samples](https://github.com/microsoft/vscode-extension-samples)
- [Publishing Guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [Webview API](https://code.visualstudio.com/api/extension-guides/webview)

---

**Last Updated**: 2026-04-09  
**Version**: 1.0
