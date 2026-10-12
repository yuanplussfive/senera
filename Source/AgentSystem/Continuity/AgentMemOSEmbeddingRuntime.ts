import { AsyncLocalStorage } from "node:async_hooks";
import {
  MemOS,
  type CreateMemoryInput,
  type EmbeddingProvider,
  type MemOSConfig,
  type SearchFilter,
  type UpdateMemoryInput,
} from "@mem-os/sdk";
import type { AgentEmbeddingClient, AgentEmbeddingRequest } from "../Vector/AgentEmbeddingContract.js";

/** MemOS uses embed() for both its write queue and searches. Public operation scopes preserve the encoder role across queued jobs and retries. */
export class AgentMemOSEmbeddingRuntime extends MemOS {
  private readonly embeddingRole: AsyncLocalStorage<AgentEmbeddingRequest["role"]>;

  constructor(
    config: Omit<MemOSConfig, "embeddings">,
    client: AgentEmbeddingClient,
    identity: { readonly id: string; readonly model: string; readonly dimensions: number },
  ) {
    const embeddingRole = new AsyncLocalStorage<AgentEmbeddingRequest["role"]>();
    const provider: EmbeddingProvider = {
      ...identity,
      // Persist the document projection identity so the SDK rebuilds vectors created with the query projection.
      model: `${identity.model}/document`,
      embed: async (text) => {
        const role = embeddingRole.getStore();
        if (!role) throw new Error("MemOS embedding requires an explicit query or document operation scope.");
        const result = await client.embed({
          input: [text],
          role,
          priority: role === "query" ? "foreground" : "background",
        });
        const vector = result.vectors[0];
        if (
          result.vectors.length !== 1 ||
          !vector ||
          vector.length !== identity.dimensions ||
          vector.some((value) => !Number.isFinite(value))
        ) {
          throw new Error(`MemOS embedding must return one finite vector with ${identity.dimensions} dimensions.`);
        }
        return vector;
      },
    };
    super({ ...config, embeddings: { provider } });
    this.embeddingRole = embeddingRole;
  }

  override store(content: string, options?: Omit<CreateMemoryInput, "content">) {
    return this.embeddingRole.run("document", () => super.store(content, options));
  }
  override init() {
    return this.embeddingRole.run("document", () => super.init());
  }
  override async update(id: string, input: UpdateMemoryInput) {
    if (input.content !== undefined || input.summary !== undefined) await this.flushEmbeddings();
    return this.embeddingRole.run("document", () => super.update(id, input));
  }
  override search(query: string | SearchFilter) {
    return this.embeddingRole.run("query", () => super.search(query));
  }
}
