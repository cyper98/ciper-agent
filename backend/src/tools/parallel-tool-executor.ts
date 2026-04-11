import { ToolAction, ToolResult } from '@ciper-agent/shared';
import { ToolExecutor } from './ToolExecutor';

export interface BatchToolCall {
  id: string;
  action: ToolAction;
}

export interface BatchToolResult {
  id: string;
  result: ToolResult;
}

/**
 * Dispatches multiple tool calls concurrently via Promise.all.
 * Write operations targeting the same path are serialized within a group;
 * all read-only tools (read_file, list_files, search_code) run fully in parallel.
 */
export class ParallelToolExecutor {
  constructor(private executor: ToolExecutor) {}

  async executeBatch(calls: BatchToolCall[]): Promise<BatchToolResult[]> {
    if (calls.length === 0) return [];

    const groups = this.partitionCalls(calls);
    const results: BatchToolResult[] = [];

    // Groups run concurrently; calls within a write-conflict group run sequentially
    await Promise.all(
      groups.map(async (group) => {
        for (const call of group) {
          const result = await this.executor.execute(call.action);
          results.push({ id: call.id, result });
        }
      })
    );

    return results;
  }

  /** Separate calls into independent groups. Write-write conflicts on same path share a group. */
  private partitionCalls(calls: BatchToolCall[]): BatchToolCall[][] {
    const writeGroups = new Map<string, BatchToolCall[]>();
    const independent: BatchToolCall[] = [];

    for (const call of calls) {
      const writePath = this.getWritePath(call.action);
      if (writePath) {
        const group = writeGroups.get(writePath) ?? [];
        group.push(call);
        writeGroups.set(writePath, group);
      } else {
        independent.push(call);
      }
    }

    const groups: BatchToolCall[][] = [];
    if (independent.length > 0) groups.push(independent);
    writeGroups.forEach(g => groups.push(g));
    return groups;
  }

  /** Returns the target path for write operations; null for read-only tools. */
  private getWritePath(action: ToolAction): string | null {
    if (action.type === 'write_file' || action.type === 'edit_file') {
      return action.path;
    }
    return null;
  }
}
