// Inline completion (Fill-in-the-Middle) prompt template
export function buildCompletionPrompt(params: {
  prefix: string;        // Code before cursor
  suffix: string;        // Code after cursor
  language: string;
  filePath: string;
}): string {
  const { prefix, suffix, language, filePath } = params;

  return `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`;
}

/**
 * Enhanced completion prompt with project awareness.
 * Suggests code that fits the project's patterns and style.
 */
export function buildChatCompletionPrompt(params: {
  prefix: string;
  suffix: string;
  language: string;
  filePath: string;
  projectContext?: string;
}): string {
  const { prefix, suffix, language, filePath, projectContext } = params;

  const contextSection = projectContext
    ? `\n\nProject context (recent changes, patterns):\n${projectContext}`
    : '';

  return `You are completing ${language} code in "${filePath}".

Code before cursor:
\`\`\`${language}
${prefix}
\`\`\`

Code after cursor:
\`\`\`${language}
${suffix}
\`\`\`${contextSection}

IMPORTANT RULES:
1. Output ONLY the code to insert — no markdown, no explanation, no comments about what you're doing
2. Match the indentation style of the surrounding code
3. Complete the current statement/function/class — don't add extra newlines at the end
4. If inside a function body, complete the function body naturally
5. If at class level, complete the class member
6. If the line is incomplete (no closing bracket/semicolon), complete it first
7. Keep completions concise — prefer 1-3 lines over 10+ lines

Output just the completion text:`;
}

/**
 * Build a context-aware completion prompt that includes:
 * - File type/framework detection
 * - Recent git changes hints
 * - Project structure hints
 */
export function buildContextAwareCompletionPrompt(params: {
  prefix: string;
  suffix: string;
  language: string;
  filePath: string;
  gitDiff?: string;
  openFiles?: string[];
}): string {
  const { prefix, suffix, language, filePath, gitDiff, openFiles } = params;

  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const framework = detectFramework(ext, openFiles ?? []);
  
  const frameworkHints: Record<string, string> = {
    react: 'Uses React hooks, JSX syntax, component-based patterns',
    vue: 'Uses Vue 3 Composition API, template syntax',
    node: 'Uses Express/Koa patterns, async/await, module exports',
    typescript: 'Strong typing, interfaces, type guards',
    python: 'Uses async/await, type hints, f-strings',
    rust: 'Uses match patterns, Result/Option types, ownership',
  };

  const gitSection = gitDiff
    ? `\n\nRecent file changes (for context):\n\`\`\`diff\n${gitDiff.slice(0, 1500)}\n\`\`\``
    : '';

  const frameworkSection = framework ? `\n\nFramework hints: ${frameworkHints[framework] ?? 'Standard patterns'}` : '';

  return `Complete this ${language} code snippet. Match the project's established patterns.

File: ${filePath}${frameworkSection}${gitSection}

Before cursor:
\`\`\`${language}
${prefix}
\`\`\`

After cursor:
\`\`\`${language}
${suffix}
\`\`\`

Output ONLY the completion — no explanation, no markdown. Just the code:`;
}

function detectFramework(ext: string, openFiles: string[]): string | undefined {
  const allFiles = openFiles.join(' ').toLowerCase();
  
  if (ext === 'tsx' || ext === 'jsx') {
    if (allFiles.includes('useeffect') || allFiles.includes('usestate') || allFiles.includes('jsx')) return 'react';
    if (allFiles.includes('ref(') || allFiles.includes('computed') || allFiles.includes('<script')) return 'vue';
  }
  
  if (ext === 'ts' || ext === 'js') {
    if (allFiles.includes('express') || allFiles.includes('koa') || allFiles.includes('fastify')) return 'node';
    if (allFiles.includes(': string') || allFiles.includes(': number') || allFiles.includes('interface ')) return 'typescript';
  }
  
  if (ext === 'py') return 'python';
  if (ext === 'rs') return 'rust';
  
  return undefined;
}
