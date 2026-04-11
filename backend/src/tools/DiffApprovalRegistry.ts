/**
 * Shared registry for pending diff approval promises.
 * Both WriteFileTool and EditFileTool register here.
 * AgentRunner resolves through this registry.
 */
const resolvers = new Map<string, (approved: boolean) => void>();

export const DiffApprovalRegistry = {
  /** Called by a tool: suspends execution until user approves/rejects. */
  wait(diffId: string, timeoutMs = 5 * 60 * 1000): Promise<boolean> {
    return new Promise(resolve => {
      resolvers.set(diffId, resolve);
      setTimeout(() => {
        if (resolvers.has(diffId)) {
          resolvers.delete(diffId);
          resolve(false);
        }
      }, timeoutMs);
    });
  },

  /** Called by AgentRunner when the user clicks Approve or Reject. */
  resolve(diffId: string, approved: boolean): void {
    const resolver = resolvers.get(diffId);
    if (resolver) {
      resolvers.delete(diffId);
      resolver(approved);
    }
  },

  has(diffId: string): boolean {
    return resolvers.has(diffId);
  },
};
