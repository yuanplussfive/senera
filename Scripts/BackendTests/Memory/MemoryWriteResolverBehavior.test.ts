import { describe, expect, test, vi } from "vitest";
import {
  AgentMemoryWriteResolver,
  type AgentMemoryWriteResolutionClient,
} from "../../../Source/AgentSystem/Memory/AgentMemoryWriteResolver.js";
import {
  InMemoryAgentMemorySourceRepository,
  type AgentMemoryConsolidationActionRecord,
  type AgentMemoryDirectWriteInput,
  type AgentMemoryItemRecord,
} from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import type { AgentMemoryVectorClient } from "../../../Source/AgentSystem/Memory/AgentMemoryVectorIndex.js";

describe("Memory write resolver behavior", () => {
  test("returns create decisions directly when no comparable active memory exists", async () => {
    const repository = new InMemoryAgentMemorySourceRepository();
    const client = fakeResolutionClient();
    const resolver = createResolver(repository, client, fakeVectorClient());
    const proposed = proposedWrite();

    await expect(resolver.resolve(request(proposed))).resolves.toEqual(proposed);

    expect(client.resolveMemoryWrite).not.toHaveBeenCalled();
  });

  test("passes similar active memories into the resolution prompt", async () => {
    const repository = new InMemoryAgentMemorySourceRepository();
    const active = repository.writeDirectMemory(
      directWrite({
        claim: "Promote verified previews without rebuilding",
      }),
    );
    repository.upsertMemoryItemVectors([vector(active, [1, 0])]);
    const client = fakeResolutionClient({
      resolveMemoryWrite: async (input) => ({
        decision: {
          ...input.proposed,
          operation: "reinforce",
          targetMemoryUri: active.uri,
          candidateUris: input.proposed.candidateUris,
          sourceRefs: input.proposed.sourceRefs,
          reason: "The new memory reinforces an existing release workflow.",
          confidence: 0.93,
        },
      }),
    });
    const resolver = createResolver(repository, client, fakeVectorClient());

    const resolved = await resolver.resolve(request(proposedWrite()));

    expect(client.resolveMemoryWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        proposed: expect.objectContaining({
          claim: "Promote verified release candidates without rebuilding",
        }),
        similarMemories: [
          expect.objectContaining({
            uri: active.uri,
            similarity: expect.any(Number),
          }),
        ],
      }),
      expect.objectContaining({ signal: undefined }),
    );
    expect(resolved).toEqual(
      expect.objectContaining({
        operation: "reinforce",
        targetMemoryUri: active.uri,
      }),
    );
  });

  test("includes explicit target memory even when vector ranking does not return it", async () => {
    const repository = new InMemoryAgentMemorySourceRepository();
    const target = repository.writeDirectMemory(
      directWrite({
        claim: "Use signed previews before stable releases",
      }),
    );
    const client = fakeResolutionClient({
      resolveMemoryWrite: async (input) => ({
        decision: {
          ...input.proposed,
          operation: "update",
          targetMemoryUri: target.uri,
          reason: "The target memory is explicitly requested.",
        },
      }),
    });
    const resolver = createResolver(
      repository,
      client,
      fakeVectorClient({
        embed: async () => ({ model: "test-embedding", vectors: [] }),
      }),
    );

    await resolver.resolve(
      request(
        proposedWrite({
          operation: "update",
          targetMemoryUri: target.uri,
        }),
      ),
    );

    expect(client.resolveMemoryWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        similarMemories: [
          expect.objectContaining({
            uri: target.uri,
            similarity: 1,
          }),
        ],
      }),
      expect.anything(),
    );
  });

  test("repairs invalid resolution output before returning a validated decision", async () => {
    const repository = new InMemoryAgentMemorySourceRepository();
    const active = repository.writeDirectMemory(directWrite());
    repository.upsertMemoryItemVectors([vector(active, [1, 0])]);
    const client = fakeResolutionClient({
      resolveMemoryWrite: async (input) => ({
        decision: {
          ...input.proposed,
          operation: "reinforce",
          targetMemoryUri: "memory://missing",
          reason: "Invalid target",
        },
      }),
      repairMemoryWriteResolution: async (input) => ({
        decision: {
          ...input.input.proposed,
          operation: "reinforce",
          targetMemoryUri: active.uri,
          reason: "Repaired to the similar memory.",
          confidence: 0.95,
        },
      }),
    });
    const resolver = createResolver(repository, client, fakeVectorClient(), {
      maxRepairAttempts: 1,
    });

    const resolved = await resolver.resolve(request(proposedWrite()));

    expect(client.repairMemoryWriteResolution).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          similarMemories: [expect.objectContaining({ uri: active.uri })],
        }),
        issues: expect.arrayContaining([expect.stringContaining("memory uri 不属于 similarMemories")]),
      }),
      expect.objectContaining({ signal: undefined }),
    );
    expect(resolved).toEqual(
      expect.objectContaining({
        operation: "reinforce",
        targetMemoryUri: active.uri,
        confidence: 0.95,
      }),
    );
  });
});

function createResolver(
  repository: InMemoryAgentMemorySourceRepository,
  client: AgentMemoryWriteResolutionClient,
  vectorClient: AgentMemoryVectorClient,
  options: {
    maxRepairAttempts?: number;
  } = {},
): AgentMemoryWriteResolver {
  return new AgentMemoryWriteResolver({
    repository,
    client,
    vectorClient,
    embeddingModel: "test-embedding",
    memoryLearningConfig: {
      Promotion: {
        MinSupport: 1,
        MaxClusterSize: 5,
        MinSimilarity: 0.1,
      },
    },
    maxRepairAttempts: options.maxRepairAttempts ?? 0,
  });
}

function request(proposed: AgentMemoryConsolidationActionRecord) {
  return {
    source: "automatic_learning" as const,
    requestId: "request-memory",
    standaloneRequest: "Remember release workflow",
    proposed,
  };
}

function proposedWrite(
  overrides: Partial<AgentMemoryConsolidationActionRecord> = {},
): AgentMemoryConsolidationActionRecord {
  return {
    operation: "create",
    type: "preference",
    subject: "release workflow",
    claim: "Promote verified release candidates without rebuilding",
    howToApply: "Use the same verified artifact for stable promotion.",
    tags: ["release"],
    triggers: ["publish"],
    sourceRefs: ["source://release"],
    candidateUris: ["candidate://release"],
    reason: "The user asked Senera to remember this release workflow.",
    confidence: 0.87,
    ...overrides,
  };
}

function directWrite(overrides: Partial<AgentMemoryDirectWriteInput> = {}): AgentMemoryDirectWriteInput {
  return {
    operation: "create",
    type: "preference",
    subject: "release workflow",
    claim: "Promote verified release candidates without rebuilding",
    howToApply: "Use the same verified artifact for stable promotion.",
    tags: ["release"],
    triggers: ["publish"],
    confidence: 0.9,
    requestId: "direct-memory",
    writtenAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function fakeResolutionClient(
  overrides: Partial<AgentMemoryWriteResolutionClient> = {},
): AgentMemoryWriteResolutionClient & {
  resolveMemoryWrite: ReturnType<typeof vi.fn<AgentMemoryWriteResolutionClient["resolveMemoryWrite"]>>;
  repairMemoryWriteResolution: ReturnType<
    typeof vi.fn<AgentMemoryWriteResolutionClient["repairMemoryWriteResolution"]>
  >;
} {
  return {
    resolveMemoryWrite: vi.fn(
      overrides.resolveMemoryWrite ??
        (async (input) => ({
          decision: {
            ...input.proposed,
            reason: "Default resolver response.",
          },
        })),
    ),
    repairMemoryWriteResolution: vi.fn(
      overrides.repairMemoryWriteResolution ??
        (async (input) => ({
          decision: {
            ...input.input.proposed,
            reason: "Default repaired resolver response.",
          },
        })),
    ),
  };
}

function fakeVectorClient(overrides: Partial<AgentMemoryVectorClient> = {}): AgentMemoryVectorClient & {
  embed: ReturnType<typeof vi.fn<AgentMemoryVectorClient["embed"]>>;
  rerank: ReturnType<typeof vi.fn<AgentMemoryVectorClient["rerank"]>>;
} {
  return {
    embed: vi.fn(
      overrides.embed ??
        (async (input) => ({
          model: "test-embedding",
          vectors: input.input.map(() => [1, 0]),
        })),
    ),
    rerank: vi.fn(
      overrides.rerank ??
        (async (input) => ({
          model: "test-rerank",
          results: input.documents.map((document, index) => ({
            id: document.id,
            index,
            score: 1 - index * 0.01,
          })),
        })),
    ),
  };
}

function vector(item: AgentMemoryItemRecord, embedding: number[]) {
  return {
    memoryUri: item.uri,
    model: "test-embedding",
    embedding,
    updatedAt: item.updatedAt,
  };
}
