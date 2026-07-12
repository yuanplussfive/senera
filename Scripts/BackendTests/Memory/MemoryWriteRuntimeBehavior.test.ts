import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  writeAgentMemory,
  type AgentMemoryWriteDecisionResolverFactory,
  type MemoryWriteToolArguments,
} from "../../../Source/AgentSystem/Memory/AgentMemoryWriteRuntime.js";
import { SqliteAgentMemorySourceRepository } from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    removeDirectory(temporaryDirectories.pop()!);
  }
});

describe("Memory write runtime behavior", () => {
  test("writes explicit memory without embedding when embedding is disabled", async () => {
    const repository = createRepository();
    try {
      const result = await writeAgentMemory(memoryArguments(), {
        repository,
        config: memoryWriteConfig,
        requestId: "write-1",
      });

      expect(result).toMatchObject({
        status: "written",
        warnings: { item: [] },
        memories: {
          item: [
            expect.objectContaining({
              operation: "create",
              claim: "Promote verified previews without rebuilding",
            }),
          ],
        },
      });
      expect(repository.listActiveMemoryItems()).toHaveLength(1);
      expect(repository.listMemoryItemVectors("test-embedding")).toEqual([]);
    } finally {
      repository.close();
    }
  });

  test("applies reinforce, update, and supersede operations to the specified memory", async () => {
    const repository = createRepository();
    try {
      const created = await writeAgentMemory(memoryArguments(), { repository, config: memoryWriteConfig });
      const memoryUri = created.memories.item[0]?.memoryUri;
      expect(memoryUri).toBeTruthy();

      await writeAgentMemory(
        memoryArguments({
          operation: "reinforce",
          targetMemoryUri: memoryUri,
          confidence: 0.9,
          tags: ["release", "verified"],
        }),
        { repository, config: memoryWriteConfig },
      );
      const updated = await writeAgentMemory(
        memoryArguments({
          operation: "update",
          targetMemoryUri: memoryUri,
          claim: "Promote a verified preview after all checks pass",
        }),
        { repository, config: memoryWriteConfig },
      );
      const superseded = await writeAgentMemory(
        memoryArguments({
          operation: "supersede",
          targetMemoryUri: updated.memories.item[0]?.memoryUri,
          claim: "Promote the signed release candidate after verification",
        }),
        { repository, config: memoryWriteConfig },
      );

      const active = repository.listActiveMemoryItems();
      expect(active).toEqual([
        expect.objectContaining({
          uri: superseded.memories.item[0]?.memoryUri,
          claim: "Promote the signed release candidate after verification",
        }),
      ]);
      expect(repository.listMemoryObservations(memoryUri!).map((entry) => entry.operation)).toEqual([
        "create",
        "reinforce",
        "update",
      ]);
    } finally {
      repository.close();
    }
  });

  test("uses the decision resolver only when a comparable active memory needs consolidation", async () => {
    const repository = createRepository();
    try {
      const original = await writeAgentMemory(memoryArguments(), { repository, config: memoryWriteConfig });
      const targetMemoryUri = original.memories.item[0]!.memoryUri;
      const resolutions: Array<{ requestId: string; claim: string }> = [];
      const createDecisionResolver: AgentMemoryWriteDecisionResolverFactory = () => ({
        resolve: async (input) => {
          resolutions.push({ requestId: input.requestId, claim: input.proposed.claim });
          return {
            ...input.proposed,
            operation: "reinforce",
            targetMemoryUri,
            confidence: 0.95,
            reason: "The new instruction confirms the existing release preference.",
          };
        },
      });

      const result = await writeAgentMemory(
        memoryArguments({
          claim: "Keep promoting verified previews before stable releases",
        }),
        {
          repository,
          config: memoryWriteConfig,
          requestId: "write-2",
          createDecisionResolver,
        },
      );

      expect(resolutions).toEqual([
        {
          requestId: "write-2",
          claim: "Keep promoting verified previews before stable releases",
        },
      ]);
      expect(result.memories.item[0]).toMatchObject({
        memoryUri: targetMemoryUri,
        operation: "reinforce",
        confidence: 0.95,
      });
      expect(repository.listActiveMemoryItems()).toHaveLength(1);
    } finally {
      repository.close();
    }
  });

  test("does not persist a memory when the consolidation decision rejects it", async () => {
    const repository = createRepository();
    try {
      await writeAgentMemory(memoryArguments(), { repository, config: memoryWriteConfig });
      const createDecisionResolver: AgentMemoryWriteDecisionResolverFactory = () => ({
        resolve: async (input) => ({
          ...input.proposed,
          operation: "reject",
          reason: "The instruction is too transient for long-term memory.",
        }),
      });

      const result = await writeAgentMemory(
        memoryArguments({
          claim: "This one-off release is happening today",
        }),
        {
          repository,
          config: memoryWriteConfig,
          createDecisionResolver,
        },
      );

      expect(result).toEqual(
        expect.objectContaining({
          status: "skipped",
          memories: { item: [] },
        }),
      );
      expect(repository.listActiveMemoryItems()).toHaveLength(1);
    } finally {
      repository.close();
    }
  });
});

const memoryWriteConfig: AgentSystemConfig = {
  ModelProviderEndpoints: [
    {
      Id: "test-endpoint",
      BaseUrl: "https://model.example/v1",
      ApiKey: "test-key",
    },
  ],
  ModelProviders: [
    {
      Id: "test-model",
      ProviderId: "test-endpoint",
      Endpoint: "ChatCompletions",
      Model: "test-model",
    },
  ],
  VectorModels: {
    Embedding: { Enabled: false },
    Rerank: { Enabled: false },
  },
};

function createRepository(): SqliteAgentMemorySourceRepository {
  const directory = createTemporaryDirectory("senera-memory-write");
  temporaryDirectories.push(directory);
  return new SqliteAgentMemorySourceRepository(path.join(directory, "Memory.sqlite"));
}

function memoryArguments(overrides: Partial<MemoryWriteToolArguments> = {}): MemoryWriteToolArguments {
  return {
    operation: "create",
    type: "preference",
    subject: "release workflow",
    claim: "Promote verified previews without rebuilding",
    howToApply: "Run verification on the preview, then promote the same artifact.",
    tags: ["release"],
    triggers: ["publish"],
    confidence: 0.8,
    ...overrides,
  };
}
