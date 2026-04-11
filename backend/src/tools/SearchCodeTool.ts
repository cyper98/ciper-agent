import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ToolResult } from '@ciper-agent/shared';

const MAX_RESULTS = 50;
const MAX_FILE_SIZE = 512 * 1024; // 512KB

export class SearchCodeTool {
  constructor(private workspaceRoot: string) {}

  async execute(params: { query: string; filePattern?: string }): Promise<ToolResult> {
    try {
      const pattern = params.filePattern || '**/*.{ts,tsx,js,jsx,py,go,rs,java,cpp,c,h,cs,rb,php}';
      const uris = await vscode.workspace.findFiles(
        pattern,
        '{**/node_modules/**,**/dist/**,**/.git/**,**/out/**}'
      );

      const results: string[] = [];
      const queryLower = params.query.toLowerCase();
      let queryRegex: RegExp | null = null;

      try {
        queryRegex = new RegExp(params.query, 'i');
      } catch {
        // Not a valid regex — use plain string search
      }

      for (const uri of uris) {
        if (results.length >= MAX_RESULTS) break;

        try {
          const stat = fs.statSync(uri.fsPath);
          if (stat.size > MAX_FILE_SIZE) continue;

          const content = fs.readFileSync(uri.fsPath, 'utf-8');
          const lines = content.split('\n');
          const filePath = path.relative(this.workspaceRoot, uri.fsPath);

          for (let i = 0; i < lines.length && results.length < MAX_RESULTS; i++) {
            const line = lines[i];
            const matches = queryRegex
              ? queryRegex.test(line)
              : line.toLowerCase().includes(queryLower);

            if (matches) {
              results.push(`${filePath}:${i + 1}: ${line.trim()}`);
            }
          }
        } catch {
          // Skip unreadable files
        }
      }

      if (results.length === 0) {
        return {
          ok: true,
          output: `No matches found for "${params.query}"${params.filePattern ? ` in ${params.filePattern}` : ''}`,
        };
      }

      return {
        ok: true,
        output:
          `Found ${results.length} match(es) for "${params.query}":\n` +
          results.join('\n'),
      };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}
