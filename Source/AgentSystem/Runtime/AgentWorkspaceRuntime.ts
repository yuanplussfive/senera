import { AgentMcpToolClientPool } from "../Mcp/AgentMcpToolClientPool.js";
import { AgentUploadStore } from "../Uploads/AgentUploadStore.js";
import type { ResolvedAgentUploadsConfig } from "../Types/AgentConfigTypes.js";

export interface AgentWorkspaceRuntimeServices {
  readonly mcpClientPool: AgentMcpToolClientPool;
  readonly uploadStore: AgentUploadStore;
}

export interface AgentWorkspaceRuntimeOptions {
  readonly mcpClientPool?: AgentMcpToolClientPool;
  readonly uploadStore?: AgentUploadStore;
  readonly workspaceRoot: string;
  readonly uploads: ResolvedAgentUploadsConfig | (() => ResolvedAgentUploadsConfig);
}

export class AgentWorkspaceRuntime implements AgentWorkspaceRuntimeServices {
  readonly mcpClientPool: AgentMcpToolClientPool;
  readonly uploadStore: AgentUploadStore;
  private closePromise?: Promise<void>;

  constructor(options: AgentWorkspaceRuntimeOptions) {
    this.mcpClientPool = options.mcpClientPool ?? new AgentMcpToolClientPool();
    this.uploadStore =
      options.uploadStore ?? new AgentUploadStore({ workspaceRoot: options.workspaceRoot, config: options.uploads });
  }

  close(): Promise<void> {
    return (this.closePromise ??= this.mcpClientPool.close());
  }
}
