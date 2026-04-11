import { OllamaChatMessage } from '../llm/OllamaClient';
import { ResponseParser, ParsedAgentResponse } from './ResponseParser';

const MAX_RETRIES = 3;

export interface RetryResult {
  parsed: ParsedAgentResponse;
  /** The raw LLM response string that successfully parsed — use this for history, not the original broken one. */
  finalResponse: string;
}

/**
 * Wraps ResponseParser with retry logic.
 * On parse failure, injects the error back into the conversation and retries.
 * Returns both the parsed result AND the final valid raw response string.
 */
export class RetryStrategy {
  constructor(private parser: ResponseParser) {}

  async parseWithRetry(
    rawResponse: string,
    history: OllamaChatMessage[],
    onRetry: (attempt: number, error: string) => void,
    llmCall: (messages: OllamaChatMessage[]) => Promise<string>
  ): Promise<RetryResult> {
    let currentResponse = rawResponse;
    const workingHistory = [...history];

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return { parsed: this.parser.parse(currentResponse), finalResponse: currentResponse };
      } catch (err) {
        if (attempt === MAX_RETRIES) {
          throw new Error(
            `Failed to parse agent response after ${MAX_RETRIES} attempts.\n` +
              `Last error: ${this.parser.describeError(err)}\n` +
              `Last response: ${currentResponse.slice(0, 500)}`
          );
        }

        const errorDescription = this.parser.describeError(err);
        onRetry(attempt, errorDescription);

        workingHistory.push(
          { role: 'assistant', content: currentResponse },
          {
            role: 'user',
            content:
              `Your response was not valid JSON. ${errorDescription}\n\n` +
              `CRITICAL: Your previous response was INVALID — the tool was NEVER executed. ` +
              `The file has NOT been modified. Do NOT output "done". ` +
              `You must output the action you intended to take.\n\n` +
              `REQUIRED schema — your ENTIRE response must be exactly this shape:\n` +
              `{"thought":"I need to read the file first.","action":{"type":"read_file","path":"src/main.ts"}}\n\n` +
              `RULES:\n` +
              `1. Only two top-level keys: "thought" (string) and "action" (object).\n` +
              `2. "action.type" must be one of: read_file, write_file, edit_file, list_files, search_code, run_command, done.\n` +
              `3. NEVER use {"tool":"...","result":{...}} — FORBIDDEN.\n` +
              `4. NEVER use {"function_call":{...}} — FORBIDDEN.\n` +
              `5. No markdown, no code fences, no prose before or after.\n` +
              `6. ALL string values must use JSON escaping (\\n for newlines, \\\\ for backslash, \\" for quote).\n\n` +
              `Now respond with the corrected JSON only:`,
          }
        );

        currentResponse = await llmCall(workingHistory);
      }
    }

    throw new Error('Unreachable');
  }
}
