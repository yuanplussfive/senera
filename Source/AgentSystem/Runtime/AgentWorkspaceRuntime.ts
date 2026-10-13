import { AgentMcpToolClientPool } from "../Mcp/AgentMcpToolClientPool.js";
import { AgentUploadStore } from "../Uploads/AgentUploadStore.js";
import type { AgentWorkspaceChangeObserverPort } from "../Artifacts/AgentWorkspaceChangeObserver.js";
import { AgentWorkspaceChangeObserverProcess } from "../Artifacts/AgentWorkspaceChangeObserverProcess.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type {
  ResolvedAgentArtifactsConfig,
  ResolvedAgentMcpConnectionsConfig,
  ResolvedAgentUploadsConfig,
} from "../Types/AgentConfigTypes.js";
import { AgentWorkspaceEmbeddingRuntime } from "../ToolSearch/AgentWorkspaceEmbeddingRuntime.js";
import { resolveAgentWorkspaceLayout, type AgentWorkspaceLayout } from "../Core/AgentWorkspaceLayout.js";
import { AgentArtifactManifestIndexCache } from "../Memory/AgentArtifactManifestIndexCache.js";

export interface AgentWorkspaceRuntimeServices {
  readonly artifactManifestIndex?: AgentArtifactManifestIndexCache;
  readonly layout?: AgentWorkspaceLayout;
  readonly mcpClientPool: AgentMcpToolClientPool;
  readonly uploadStore: AgentUploadStore;
  readonly workspaceChangeObserver: AgentWorkspaceChangeObserverPort & { close(): Promise<void> };
  readonly embedding: AgentWorkspaceEmbeddingRuntime;
}

export interface AgentWorkspaceRuntimeOptions {
  readonly layout?: AgentWorkspaceLayout;
  readonly mcpClientPool?: AgentMcpToolClientPool;
  readonly uploadStore?: AgentUploadStore;
  readonly workspaceRoot: string;
  readonly uploads: ResolvedAgentUploadsConfig | (() => ResolvedAgentUploadsConfig);
  readonly artifacts: () => ResolvedAgentArtifactsConfig;
  readonly logger?: AgentLogger;
  /** Resolves MCP connection eviction settings for the current config revision. */
  readonly mcpConnections?: () => ResolvedAgentMcpConnectionsConfig;
  /** Optional injection point for tests or an embedding implementation owned by the host. */
  readonly embedding?: AgentWorkspaceEmbeddingRuntime;
  /** Optional observer injection for focused tests and specialized hosts. */
  readonly workspaceChangeObserver?: AgentWorkspaceChangeObserverPort & { close(): Promise<void> };
}

export class AgentWorkspaceRuntime implements AgentWorkspaceRuntimeServices {
  readonly artifactManifestIndex: AgentArtifactManifestIndexCache;
  readonly layout: AgentWorkspaceLayout;
  readonly mcpClientPool: AgentMcpToolClientPool;
  readonly uploadStore: AgentUploadStore;
  readonly workspaceChangeObserver: AgentWorkspaceChangeObserverPort & { close(): Promise<void> };
  readonly embedding: AgentWorkspaceEmbeddingRuntime;
  private closePromise?: Promise<void>;
  private readonly ownsEmbedding: boolean;

  constructor(options: AgentWorkspaceRuntimeOptions) {
    this.layout = options.layout ?? resolveAgentWorkspaceLayout(options.workspaceRoot);
    this.artifactManifestIndex = new AgentArtifactManifestIndexCache(this.layout.databases.artifactManifestIndex);
    const mcpConnections = options.mcpConnections;
    this.mcpClientPool =
      options.mcpClientPool ??
      new AgentMcpToolClientPool({
        policy: mcpConnections
          ? () => {
              const resolved = mcpConnections();
              return { idleTtlMs: resolved.IdleTtlMs, sweepIntervalMs: resolved.SweepIntervalMs };
            }
          : { idleTtlMs: 0, sweepIntervalMs: 1 },
        onCloseError: (error, connection) => {
          options.logger?.warn("mcp.connection.cleanup_failed", {
            serverId: connection.server.id,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      });
    this.uploadStore =
      options.uploadStore ?? new AgentUploadStore({ workspaceRoot: options.workspaceRoot, config: options.uploads });
    this.workspaceChangeObserver =
      options.workspaceChangeObserver ??
      new AgentWorkspaceChangeObserverProcess({
        workspaceRoot: options.workspaceRoot,
        runtimeStateRoot: this.layout.stateRoot,
        config: options.artifacts,
        logger: options.logger,
      });
    this.embedding = options.embedding ?? new AgentWorkspaceEmbeddingRuntime();
    this.ownsEmbedding = options.embedding === undefined;
  }

  close(): Promise<void> {
    return (this.closePromise ??= Promise.all([
      this.workspaceChangeObserver.close(),
      this.mcpClientPool.close(),
      ...(this.ownsEmbedding ? [this.embedding.close()] : []),
    ]).then(() => undefined));
  }
}
