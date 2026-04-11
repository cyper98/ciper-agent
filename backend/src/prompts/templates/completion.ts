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
 * Chat-style completion prompt for models that don't support FIM.
 */
export function buildChatCompletionPrompt(params: {
  prefix: string;
  suffix: string;
  language: string;
  filePath: string;
}): string {
  const { prefix, suffix, language, filePath } = params;

  return `Complete the ${language} code in file "${filePath}".
The code before the cursor:
\`\`\`${language}
${prefix}
\`\`\`

The code after the cursor:
\`\`\`${language}
${suffix}
\`\`\`

Output ONLY the code to insert at the cursor position — no explanation, no markdown, no code fences. Output just the completion text.`;
}
