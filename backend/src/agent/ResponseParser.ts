import { z } from 'zod';

// Zod schema for strict validation of LLM output
const ToolActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('read_file'),   path: z.string().min(1) }),
  z.object({ type: z.literal('write_file'),  path: z.string().min(1), content: z.string() }),
  z.object({ type: z.literal('edit_file'),   path: z.string().min(1), diff: z.string().min(1) }),
  z.object({ type: z.literal('list_files'),  path: z.string().min(1) }),
  z.object({
    type: z.literal('search_code'),
    query: z.string().min(1),
    filePattern: z.string().optional(),
  }),
  z.object({
    type: z.literal('run_command'),
    command: z.string().min(1),
    cwd: z.string().optional(),
  }),
  z.object({ type: z.literal('done'), message: z.string() }),
  // Orchestrator-only: decompose task into parallel sub-agents
  z.object({
    type: z.literal('sub_tasks'),
    tasks: z.array(z.object({
      id: z.string().min(1),
      description: z.string().min(1),
      hint: z.string().optional(),
    })).min(1),
  }),
]);

const AgentResponseSchema = z.object({
  thought: z.string(),
  action: ToolActionSchema,
});

export type ParsedAgentResponse = z.infer<typeof AgentResponseSchema>;

export class ResponseParser {
  parse(raw: string): ParsedAgentResponse {
    const jsonStr = this.extractJson(raw);
    const sanitized = this.sanitizeControlChars(jsonStr);
    const parsed = JSON.parse(sanitized);
    // Normalize common LLM field-name variants before strict schema validation
    if (parsed?.action && typeof parsed.action === 'object') {
      this.normalizeAction(parsed.action as Record<string, unknown>);
    }
    return AgentResponseSchema.parse(parsed);
  }

  /**
   * Map common LLM path-field aliases to the required "path" key.
   * Models frequently emit "file", "filename", "filepath" etc. instead of "path".
   */
  private normalizeAction(action: Record<string, unknown>): void {
    if ('path' in action) return;
    const PATH_ALIASES = ['file', 'filename', 'filepath', 'filePath', 'file_path'];
    for (const alias of PATH_ALIASES) {
      if (alias in action) {
        action.path = action[alias];
        delete action[alias];
        return;
      }
    }
  }

  /**
   * Extract the outermost JSON object from raw text.
   * - Strips a leading code fence (```json / ```javascript / ```) only when the
   *   response itself starts with one — avoids false matches on fences that appear
   *   *inside* JSON string values (e.g. write_file content with markdown examples).
   * - Always applies brace/quote depth tracking so preamble text before the `{`
   *   (e.g. "\nUser → Ciper: ...") is skipped correctly in both fence and no-fence paths.
   */
  private extractJson(raw: string): string {
    let text = raw.trim();

    // Only strip the outer fence if the response itself starts with ```
    // Use indexOf (not lastIndexOf) for the close fence so an embedded ``` inside
    // a JSON string value (e.g. write_file content) does not truncate the object.
    if (text.startsWith('```')) {
      const firstNewline = text.indexOf('\n');
      const closeFence = firstNewline !== -1 ? text.indexOf('\n```', firstNewline + 1) : -1;
      if (firstNewline !== -1 && closeFence > firstNewline) {
        text = text.slice(firstNewline + 1, closeFence).trim();
      } else if (firstNewline !== -1) {
        // Opening fence line only (no closing fence found) — strip the first line
        text = text.slice(firstNewline + 1).trim();
      }
    }

    // Find and extract the outermost JSON object via brace depth tracking.
    // This correctly skips any prose before { and handles braces/quotes inside strings.
    const start = text.indexOf('{');
    if (start === -1) {
      throw new Error('No JSON object found in response');
    }

    let depth = 0;
    let inString = false;
    let i = start;

    while (i < text.length) {
      const ch = text[i];

      if (inString) {
        if (ch === '\\') {
          i += 2; // skip escaped character entirely
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        // Raw control chars inside strings are handled by sanitizeControlChars later
      } else {
        if (ch === '"') {
          inString = true;
        } else if (ch === '{') {
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0) {
            return text.slice(start, i + 1);
          }
        }
      }
      i++;
    }

    throw new Error('Incomplete JSON object in response');
  }

  /**
   * Escape raw control characters (newlines, tabs, etc.) that appear inside
   * JSON string values. LLMs frequently emit literal \n instead of \\n inside
   * content/diff fields, which makes JSON.parse throw "Bad control character".
   */
  private sanitizeControlChars(json: string): string {
    let result = '';
    let inString = false;
    let i = 0;

    while (i < json.length) {
      const ch = json[i];
      const code = json.charCodeAt(i);

      if (inString) {
        if (ch === '\\') {
          // Valid escape sequence — keep both characters as-is
          result += ch;
          if (i + 1 < json.length) {
            result += json[i + 1];
            i += 2;
            continue;
          }
        } else if (ch === '"') {
          inString = false;
          result += ch;
        } else if (code < 0x20) {
          // Raw control character inside a string — must be escaped
          switch (code) {
            case 0x08: result += '\\b'; break;
            case 0x09: result += '\\t'; break;
            case 0x0a: result += '\\n'; break;
            case 0x0c: result += '\\f'; break;
            case 0x0d: result += '\\r'; break;
            default:
              result += `\\u${code.toString(16).padStart(4, '0')}`;
          }
        } else {
          result += ch;
        }
      } else {
        if (ch === '"') {
          inString = true;
        }
        result += ch;
      }
      i++;
    }

    return result;
  }

  describeError(err: unknown): string {
    if (err instanceof z.ZodError) {
      const issues = err.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
      return `Schema validation failed:\n${issues}`;
    }
    if (err instanceof SyntaxError) {
      return `JSON parse error: ${err.message}`;
    }
    return String(err);
  }
}
