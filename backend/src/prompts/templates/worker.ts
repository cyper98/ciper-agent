/** Maximum iterations a single worker agent will run before giving up. */
export const MAX_WORKER_ITERATIONS = 8;

/**
 * Builds a focused system prompt for a worker sub-agent.
 * Workers have a narrow goal and a small context window — they should not
 * explore beyond their assigned task.
 */
export function buildWorkerSystemPrompt(task: string, contextSnippet: string): string {
  return `You are a focused sub-agent. Your ONLY goal is:

${task}

Relevant workspace context:
${contextSnippet}

Output JSON in this exact format for every response:
{"thought":"<your reasoning>","action":<action object>}

Available actions:
- {"type":"read_file","path":"..."}
- {"type":"write_file","path":"...","content":"..."}
- {"type":"edit_file","path":"...","diff":"..."}
- {"type":"list_files","path":"..."}
- {"type":"search_code","query":"...","filePattern":"..."}
- {"type":"run_command","command":"..."}
- {"type":"done","message":"<1-3 sentence summary of what you accomplished>"}

Rules:
- Stay strictly within your assigned goal — do not expand scope
- Use tools to gather facts or make changes needed for your goal
- When your goal is complete, output the "done" action with a clear summary
- Max ${MAX_WORKER_ITERATIONS} steps — be concise and focused`;
}
