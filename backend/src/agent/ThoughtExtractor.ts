/**
 * Incrementally extracts the "thought" string value from a partial JSON stream.
 *
 * The agent response always begins with: {"thought":"<text here>","action":{...}}
 * This class finds the opening marker and streams chars until the closing quote,
 * unescaping common sequences (\n, \t, \\, \") for readable display.
 *
 * Usage: call push(token) for each incoming token; it returns newly visible chars
 * (or null if still waiting for the thought value to begin or already done).
 */
export class ThoughtExtractor {
  private buffer = '';
  private inThought = false;
  private thoughtDone = false;
  private extracted = '';

  push(token: string): string | null {
    if (this.thoughtDone) return null;
    this.buffer += token;

    if (!this.inThought) {
      // Wait until we see the opening: "thought":"
      const marker = '"thought":"';
      const idx = this.buffer.indexOf(marker);
      if (idx === -1) return null;
      this.buffer = this.buffer.slice(idx + marker.length);
      this.inThought = true;
    }

    // Consume chars from buffer up to the closing unescaped quote
    let newChars = '';
    let i = 0;
    while (i < this.buffer.length) {
      const ch = this.buffer[i];

      if (ch === '\\') {
        if (i + 1 < this.buffer.length) {
          // Unescape for human-readable display
          const next = this.buffer[i + 1];
          if (next === 'n') { newChars += '\n'; }
          else if (next === 't') { newChars += '\t'; }
          else if (next === '\\') { newChars += '\\'; }
          else if (next === '"') { newChars += '"'; }
          else { newChars += next; }
          i += 2;
          continue;
        } else {
          // Lone backslash at token boundary — leave in buffer for next push()
          break;
        }
      }

      if (ch === '"') {
        // End of thought string value
        this.thoughtDone = true;
        this.buffer = this.buffer.slice(i + 1);
        break;
      }

      newChars += ch;
      i++;
    }

    if (!this.thoughtDone) {
      // Haven't hit closing quote yet — keep unconsumed buffer for next push
      this.buffer = this.buffer.slice(i);
    }

    this.extracted += newChars;
    return newChars.length > 0 ? newChars : null;
  }

  /** True once the closing quote of the thought value has been seen. */
  isDone(): boolean { return this.thoughtDone; }

  /** Full thought string extracted so far. */
  getExtracted(): string { return this.extracted; }
}
