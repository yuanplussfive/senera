import type { AgentEmbeddingClient } from "../Vector/AgentEmbeddingContract.js";
import { AgentLocalEmbeddingClient, AgentLocalEmbeddingModelName } from "./AgentLocalEmbeddingClient.js";

/**
 * Workspace-owned embedding resources.
 *
 * The client is deliberately created once at the workspace boundary and is
 * lazy: constructing this object does not start the worker. Consumers borrow
 * the client for the lifetime of a model/runtime generation and never close it
 * themselves. The workspace runtime is the sole owner of the worker.
 */
export class AgentWorkspaceEmbeddingRuntime {
  readonly client: AgentEmbeddingClient;
  readonly model: string;
  readonly dimensions: number | undefined;
  private closePromise?: Promise<void>;

  constructor(options: { readonly client?: AgentEmbeddingClient; readonly model?: string } = {}) {
    this.client = options.client ?? new AgentLocalEmbeddingClient();
    this.model = options.model ?? AgentLocalEmbeddingModelName;
    this.dimensions = this.client.dimensions;
  }

  close(): Promise<void> {
    return (this.closePromise ??= Promise.resolve(this.client.close?.()).then(() => undefined));
  }
}
