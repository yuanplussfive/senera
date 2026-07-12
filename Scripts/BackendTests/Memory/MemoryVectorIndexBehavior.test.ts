import { describe, expect, test, vi } from "vitest";
import {
  ensureMemoryItemVectors,
  rankSimilarMemoryItems,
  type AgentMemoryVectorClient,
} from "../../../Source/AgentSystem/Memory/AgentMemoryVectorIndex.js";
import { InMemoryAgentMemorySourceRepository } from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import type { AgentMemoryItemRecord } from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";

describe("Memory vector index behavior", () => {
  test("embeds only memory items missing vectors for the requested model", async () => {
    const repository = new InMemoryAgentMemorySourceRepository();
    const existing = memoryItem("memory://existing", { claim: "Existing vector" });
    const missing = memoryItem("memory://missing", { claim: "Missing vector" });
    repository.upsertMemoryItemVectors([
      {
        memoryUri: existing.uri,
        model: "test-embedding",
        embedding: [0.2, 0.8],
        updatedAt: existing.updatedAt,
      },
    ]);
    const vectorClient = fakeVectorClient({
      embed: async (request) => ({
        model: "test-embedding",
        vectors: request.input.map(() => [1, 0]),
      }),
    });

    await ensureMemoryItemVectors(vectorClient, repository, [existing, missing], "test-embedding");

    expect(vectorClient.embed).toHaveBeenCalledTimes(1);
    expect(vectorClient.embed).toHaveBeenCalledWith(
      expect.objectContaining({
        input: [expect.stringContaining("Missing vector")],
      }),
    );
    expect(repository.listMemoryItemVectors("test-embedding")).toEqual([
      expect.objectContaining({ memoryUri: existing.uri, embedding: [0.2, 0.8] }),
      expect.objectContaining({ memoryUri: missing.uri, embedding: [1, 0] }),
    ]);
  });

  test("ranks memories by cosine similarity, threshold, limit, and rerank order", async () => {
    const repository = new InMemoryAgentMemorySourceRepository();
    const alpha = memoryItem("memory://alpha", { claim: "Alpha release candidate" });
    const beta = memoryItem("memory://beta", { claim: "Beta deployment checklist" });
    const gamma = memoryItem("memory://gamma", { claim: "Gamma unrelated note" });
    repository.upsertMemoryItemVectors([vector(alpha, [1, 0]), vector(beta, [0.9, 0.1]), vector(gamma, [0, 1])]);
    const vectorClient = fakeVectorClient({
      embed: async () => ({ model: "test-embedding", vectors: [[1, 0]] }),
      rerank: async (request) => ({
        model: "test-rerank",
        results: [...request.documents].reverse().map((document, index) => ({
          id: document.id,
          index,
          score: 10 - index,
        })),
      }),
    });

    const ranked = await rankSimilarMemoryItems(vectorClient, repository, {
      text: "release candidate",
      items: [alpha, beta, gamma],
      model: "test-embedding",
      limit: 2,
      minSimilarity: 0.5,
    });

    expect(vectorClient.embed).toHaveBeenCalledTimes(1);
    expect(vectorClient.rerank).toHaveBeenCalledWith(
      expect.objectContaining({
        documents: [expect.objectContaining({ id: alpha.uri }), expect.objectContaining({ id: beta.uri })],
        topK: 2,
      }),
    );
    expect(ranked.map((entry) => entry.item.uri)).toEqual([beta.uri, alpha.uri]);
  });

  test("falls back to semantic ranking when rerank returns no usable results", async () => {
    const repository = new InMemoryAgentMemorySourceRepository();
    const first = memoryItem("memory://first", { claim: "Most similar" });
    const second = memoryItem("memory://second", { claim: "Less similar" });
    repository.upsertMemoryItemVectors([vector(first, [1, 0]), vector(second, [0.6, 0.8])]);
    const vectorClient = fakeVectorClient({
      embed: async () => ({ model: "test-embedding", vectors: [[1, 0]] }),
      rerank: async () => ({ model: "test-rerank", results: [] }),
    });

    const ranked = await rankSimilarMemoryItems(vectorClient, repository, {
      text: "similar",
      items: [second, first],
      model: "test-embedding",
      limit: 5,
      minSimilarity: 0,
    });

    expect(ranked.map((entry) => entry.item.uri)).toEqual([first.uri, second.uri]);
  });

  test("returns empty results without model calls when there are no candidate items", async () => {
    const repository = new InMemoryAgentMemorySourceRepository();
    const vectorClient = fakeVectorClient();

    await expect(
      rankSimilarMemoryItems(vectorClient, repository, {
        text: "anything",
        items: [],
        model: "test-embedding",
        limit: 5,
        minSimilarity: 0,
      }),
    ).resolves.toEqual([]);

    expect(vectorClient.embed).not.toHaveBeenCalled();
    expect(vectorClient.rerank).not.toHaveBeenCalled();
  });
});

function fakeVectorClient(overrides: Partial<AgentMemoryVectorClient> = {}): AgentMemoryVectorClient & {
  embed: ReturnType<typeof vi.fn<AgentMemoryVectorClient["embed"]>>;
  rerank: ReturnType<typeof vi.fn<AgentMemoryVectorClient["rerank"]>>;
} {
  return {
    embed: vi.fn(
      overrides.embed ??
        (async (request) => ({
          model: "test-embedding",
          vectors: request.input.map(() => [1, 0]),
        })),
    ),
    rerank: vi.fn(
      overrides.rerank ??
        (async (request) => ({
          model: "test-rerank",
          results: request.documents.map((document, index) => ({
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

function memoryItem(uri: string, overrides: Partial<AgentMemoryItemRecord> = {}): AgentMemoryItemRecord {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: uri.replace(/\W/g, "_"),
    uri,
    type: "preference",
    subject: "release workflow",
    claim: "Prefer verified release candidates",
    howToApply: "Use the same artifact after verification.",
    tags: ["release"],
    triggers: ["publish"],
    sourceRefs: [],
    status: "active",
    confidence: 0.9,
    sessionId: "session-memory",
    sourceEpisodeUri: "episode://memory",
    sourceRequestId: "request-memory",
    createdAt: now,
    updatedAt: now,
    createdAtMs: 1,
    updatedAtMs: 1,
    timeZone: "Asia/Shanghai",
    localDate: "2026-01-01",
    localHour: "2026-01-01T08",
    metadata: {},
    ...overrides,
  };
}
