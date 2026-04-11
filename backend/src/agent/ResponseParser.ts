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
    return AgentResponseSchema.parse(parsed);
  }

  /**
   * Extract the outermost JSON object from raw text.
   * Correctly handles braces/quotes inside string values so code content
   * (e.g. Go `func main() { ... }`) does not confuse the depth counter.
   */
  private extractJson(raw: string): string {
    // Strip markdown code fences: ```json ... ``` or ``` ... ```
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      return fenceMatch[1].trim();
    }

    const start = raw.indexOf('{');
    if (start === -1) {
      throw new Error('No JSON object found in response');
    }

    let depth = 0;
    let inString = false;
    let i = start;

    while (i < raw.length) {
      const ch = raw[i];

      if (inString) {
        if (ch === '\\') {
          i += 2; // skip the escaped character entirely
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        // Any other character (including raw newlines) is inside a string —
        // we ignore it for depth counting; sanitizeControlChars fixes it later.
      } else {
        if (ch === '"') {
          inString = true;
        } else if (ch === '{') {
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0) {
            return raw.slice(start, i + 1);
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
