import { ToolAction, ToolResult } from '@ciper-agent/shared';
import { ReadFileTool } from './ReadFileTool';
import { WriteFileTool } from './WriteFileTool';
import { EditFileTool } from './EditFileTool';
import { ListFilesTool } from './ListFilesTool';
import { SearchCodeTool } from './SearchCodeTool';
import { RunCommandTool } from './RunCommandTool';

export interface ToolDependencies {
  readFile: ReadFileTool;
  writeFile: WriteFileTool;
  editFile: EditFileTool;
  listFiles: ListFilesTool;
  searchCode: SearchCodeTool;
  runCommand: RunCommandTool;
}

export class ToolExecutor {
  constructor(private tools: ToolDependencies) {}

  async execute(action: ToolAction): Promise<ToolResult> {
    switch (action.type) {
      case 'read_file':
        return this.tools.readFile.execute({ path: action.path });

      case 'write_file':
        return this.tools.writeFile.execute({
          path: action.path,
          content: action.content,
        });

      case 'edit_file':
        return this.tools.editFile.execute({
          path: action.path,
          diff: action.diff,
        });

      case 'list_files':
        return this.tools.listFiles.execute({ path: action.path });

      case 'search_code':
        return this.tools.searchCode.execute({
          query: action.query,
          filePattern: action.filePattern,
        });

      case 'run_command':
        return this.tools.runCommand.execute({
          command: action.command,
          cwd: action.cwd,
        });

      default:
        return {
          ok: false,
          error: `Unknown tool type: ${(action as ToolAction).type}`,
        };
    }
  }
}
