/**
 * Buffers NDJSON streaming data and splits on newlines.
 * TCP chunks can split lines — this handles that correctly.
 */
export class StreamParser {
  private buffer = '';

  /**
   * Push a new data chunk. Returns complete lines ready to parse.
   */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];

    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.trim()) {
        lines.push(line);
      }
    }

    return lines;
  }

  /**
   * Flush any remaining buffered data as a final line.
   */
  flush(): string[] {
    const remaining = this.buffer.trim();
    this.buffer = '';
    return remaining ? [remaining] : [];
  }

  reset(): void {
    this.buffer = '';
  }
}
