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

        const actionType = this.extractActionType(currentResponse);
        const schemaHint = this.schemaHintForType(actionType);

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
              `${schemaHint}\n\n` +
              `RULES:\n` +
              `1. Only two top-level keys: "thought" (string) and "action" (object).\n` +
              `2. "action.type" must be one of: read_file, write_file, edit_file, list_files, search_code, run_command, done, sub_tasks.\n` +
              `3. The field for file path is "path" — NEVER use "file", "filename", "filepath", or "filePath".\n` +
              `4. NEVER use {"tool":"...","result":{...}} — FORBIDDEN.\n` +
              `5. NEVER use {"function_call":{...}} — FORBIDDEN.\n` +
              `6. No markdown, no code fences, no prose before or after.\n` +
              `7. ALL string values must use JSON escaping (\\n for newlines, \\\\ for backslash, \\" for quote).\n\n` +
              `Now respond with the corrected JSON only:`,
          }
        );

        currentResponse = await llmCall(workingHistory);
      }
    }

    throw new Error('Unreachable');
  }

  /** Best-effort extraction of action.type from a (possibly malformed) response string. */
  private extractActionType(raw: string): string | undefined {
    const match = raw.match(/"type"\s*:\s*"([^"]+)"/);
    return match?.[1];
  }

  /** Return a concrete schema example for the given action type. */
  private schemaHintForType(type: string | undefined): string {
    const SCHEMAS: Record<string, string> = {
      read_file:    '{"thought":"I need to read the file.","action":{"type":"read_file","path":"<filename>"}}',
      write_file:   '{"thought":"I will create the file.","action":{"type":"write_file","path":"<filename>","content":"// content here"}}',
      edit_file:    '{"thought":"I will edit the file.","action":{"type":"edit_file","path":"<filename>","diff":"--- a/<filename>\\n+++ b/<filename>\\n@@ -1,3 +1,3 @@\\n ctx\\n-old\\n+new\\n ctx"}}',
      list_files:   '{"thought":"I will list the directory.","action":{"type":"list_files","path":"<directory>"}}',
      search_code:  '{"thought":"I will search for the symbol.","action":{"type":"search_code","query":"<search_term>","filePattern":"**/*.<ext>"}}',
      run_command:  '{"thought":"I will run the build.","action":{"type":"run_command","command":"<command>"}}',
      done:         '{"thought":"The task is complete.","action":{"type":"done","message":"Summary of what was accomplished."}}',
      sub_tasks:    '{"thought":"I will split this into parallel tasks.","action":{"type":"sub_tasks","tasks":[{"id":"w1","description":"<self-contained goal>"}]}}',
    };
    return SCHEMAS[type ?? ''] ?? SCHEMAS['read_file'];
  }
}
