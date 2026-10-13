import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import type { AgentExtensionRegistry } from "../../../Source/AgentSystem/Extensions/AgentExtensionRegistry.js";
import { resolveAgentWorkspaceLayout } from "../../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import { AgentToolSearchRuntime } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchRuntime.js";
import { AgentCapabilityEmbeddingFileStore } from "../../../Source/AgentSystem/ToolSearch/AgentCapabilityEmbeddingCache.js";
import {
  AgentCapabilityKinds,
  AgentCapabilitySearchIndex,
  type AgentCapabilitySearchDocument,
} from "../../../Source/AgentSystem/ToolSearch/AgentCapabilitySearchIndex.js";
import { AgentToolSearchTokenizer } from "../../../Source/AgentSystem/ToolSearch/AgentToolSearchTokenizer.js";
import type {
  AgentEmbeddingRequest,
  AgentEmbeddingResult,
} from "../../../Source/AgentSystem/Vector/AgentEmbeddingContract.js";
import { VerificationScenarioSource } from "../../VerificationScenarioSource.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";
import { createRegistry, createTool, createToolSearchConfig } from "./ToolSearchTestFixtures.js";

describe("ToolSearch embedding cache behavior", () => {
  test("prepares an embedding client before deriving document vectors", async () => {
    const lifecycle: string[] = [];
    const embedding = {
      prewarm: async () => {
        lifecycle.push("engine");
      },
      embed: async (request: AgentEmbeddingRequest): Promise<AgentEmbeddingResult> => {
        lifecycle.push(request.role);
        return { model: "embedding-test", vectors: request.input.map(() => [1, 0]) };
      },
    };
    const index = new AgentCapabilitySearchIndex([createCapabilityDocument("AlphaTool", "alpha capability")], {
      tokenizer: new AgentToolSearchTokenizer(),
      embedding: { client: embedding, model: "embedding-test" },
    });

    await index.prewarm();

    expect(lifecycle).toEqual(["engine", "document"]);
  });

  test("derives catalog vectors in client-declared cooperative batches", async () => {
    const documentBatches: string[][] = [];
    const embedding = {
      maxBatchSize: 2,
      embed: async (request: AgentEmbeddingRequest): Promise<AgentEmbeddingResult> => {
        if (request.role === "document") documentBatches.push([...request.input]);
        return { model: "embedding-test", vectors: request.input.map(() => [1, 0]) };
      },
    };
    const inputs = ["alpha", "beta", "gamma", "delta", "epsilon"];
    const index = new AgentCapabilitySearchIndex(
      inputs.map((input) => createCapabilityDocument(`${input}-tool`, `${input} capability`)),
      {
        tokenizer: new AgentToolSearchTokenizer(),
        embedding: { client: embedding, model: "embedding-test" },
      },
    );

    await index.prewarm();

    expect(documentBatches).toEqual([
      ["alpha capability", "beta capability"],
      ["gamma capability", "delta capability"],
      ["epsilon capability"],
    ]);
  });

  test("lets a foreground semantic query preempt background catalog preparation", async () => {
    let firstBackgroundDocumentStarted: (() => void) | undefined;
    const firstBackgroundDocument = new Promise<void>((resolve) => {
      firstBackgroundDocumentStarted = resolve;
    });
    let backgroundPreempted = false;
    let holdFirstDocument = true;
    const embedding = {
      embed: async (request: AgentEmbeddingRequest): Promise<AgentEmbeddingResult> => {
        if (request.role === "document" && holdFirstDocument) {
          holdFirstDocument = false;
          firstBackgroundDocumentStarted?.();
          await new Promise<void>((_resolve, reject) => {
            const rejectWhenAborted = () => {
              backgroundPreempted = true;
              reject(request.signal?.reason);
            };
            request.signal?.addEventListener("abort", rejectWhenAborted, { once: true });
          });
        }
        if (request.signal?.aborted) throw request.signal.reason;
        return {
          model: "embedding-test",
          vectors: request.input.map((input) => (input.includes("alpha") ? [1, 0] : [0, 1])),
        };
      },
    };
    const index = new AgentCapabilitySearchIndex(
      [
        createCapabilityDocument("AlphaTool", "alpha capability"),
        createCapabilityDocument("BetaTool", "beta capability"),
      ],
      {
        tokenizer: new AgentToolSearchTokenizer(),
        embedding: { client: embedding, model: "embedding-test" },
      },
    );

    const warmup = index.prewarm();
    await firstBackgroundDocument;
    await expect(index.semantic("alpha request", AgentCapabilityKinds.Tool)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "AlphaTool" })]),
    );
    await expect(warmup).resolves.toBeUndefined();

    expect(backgroundPreempted).toBe(true);
  });

  test("warms primary semantic views without expanding a flat semantic frontier", async () => {
    const documentInputs: string[] = [];
    const embedding = {
      embed: async (request: AgentEmbeddingRequest): Promise<AgentEmbeddingResult> => {
        if (request.role === "document") documentInputs.push(...request.input);
        return {
          model: "embedding-test",
          vectors: request.input.map(() => [1, 0]),
        };
      },
    };
    const index = new AgentCapabilitySearchIndex(
      [
        createCapabilityDocumentWithViews("AlphaTool", "alpha intent", "alpha contract"),
        createCapabilityDocumentWithViews("BetaTool", "beta intent", "beta contract"),
      ],
      {
        tokenizer: new AgentToolSearchTokenizer(),
        embedding: { client: embedding, model: "embedding-test" },
      },
    );

    await index.prewarm();

    expect(documentInputs).toEqual(["alpha intent", "beta intent"]);

    await index.semantic("alpha contract", AgentCapabilityKinds.Tool);

    // Equal primary vectors contain no ranking evidence for choosing a long
    // view. Auxiliary work is reserved for a statistically separated frontier
    // and is covered by the next test.
    expect(documentInputs).toEqual(["alpha intent", "beta intent"]);
  });

  test("expands auxiliary semantic views only for the score-distribution frontier", async () => {
    const documentBatches: string[][] = [];
    const embedding = {
      embed: async (request: AgentEmbeddingRequest): Promise<AgentEmbeddingResult> => {
        if (request.role === "query") return { model: "embedding-test", vectors: [[1, 0]] };
        documentBatches.push([...request.input]);
        return {
          model: "embedding-test",
          vectors: request.input.map((input) => {
            if (input.includes("alpha intent")) return [1, 0];
            if (input.includes("beta intent")) return [0.995, 0.1];
            if (input.includes("gamma intent")) return [0.4, 0.9];
            return [1, 0];
          }),
        };
      },
    };
    const index = new AgentCapabilitySearchIndex(
      [
        createCapabilityDocumentWithViews("AlphaTool", "alpha intent", "alpha contract"),
        createCapabilityDocumentWithViews("BetaTool", "beta intent", "beta contract"),
        createCapabilityDocumentWithViews("GammaTool", "gamma intent", "gamma contract"),
      ],
      {
        tokenizer: new AgentToolSearchTokenizer(),
        embedding: { client: embedding, model: "embedding-test" },
      },
    );

    await index.prewarm();
    await index.semantic("ambiguous capability", AgentCapabilityKinds.Tool);

    expect(documentBatches).toEqual([
      ["alpha intent", "beta intent", "gamma intent"],
      ["alpha contract", "beta contract"],
    ]);
  });

  test("does not let a cancelled foreground caller poison a shared preparation", async () => {
    let releaseDocument: (() => void) | undefined;
    const documentReleased = new Promise<void>((resolve) => {
      releaseDocument = resolve;
    });
    let documentStarted: (() => void) | undefined;
    const firstDocumentStarted = new Promise<void>((resolve) => {
      documentStarted = resolve;
    });
    let holdFirstDocument = true;
    const embedding = {
      embed: async (request: AgentEmbeddingRequest): Promise<AgentEmbeddingResult> => {
        if (request.role === "document" && holdFirstDocument) {
          holdFirstDocument = false;
          documentStarted?.();
          await documentReleased;
        }
        return {
          model: "embedding-test",
          vectors: request.input.map((input) => (input.includes("alpha") ? [1, 0] : [0, 1])),
        };
      },
    };
    const index = new AgentCapabilitySearchIndex([createCapabilityDocument("AlphaTool", "alpha capability")], {
      tokenizer: new AgentToolSearchTokenizer(),
      embedding: { client: embedding, model: "embedding-test" },
    });
    const firstController = new AbortController();
    const cancelled = index.semantic("alpha request", AgentCapabilityKinds.Tool, undefined, firstController.signal);
    await firstDocumentStarted;
    firstController.abort("First caller cancelled.");
    await expect(cancelled).rejects.toThrow("First caller cancelled.");

    const second = index.semantic("alpha request", AgentCapabilityKinds.Tool);
    releaseDocument?.();
    await expect(second).resolves.toEqual([expect.objectContaining({ name: "AlphaTool" })]);
  });

  test("re-embeds a capability when only its semantic description changes", async () => {
    const config = createToolSearchConfig();
    config.Embedding.Enabled = true;
    const tools = [createMutableTool("Search the original archive description.")];
    const embed = vi.fn(async ({ input }: { input: readonly string[] }) => ({
      model: "embedding-test",
      vectors: input.map(() => [1, 0]),
    }));
    const runtime = new AgentToolSearchRuntime(
      createRegistry(tools) as unknown as AgentExtensionRegistry,
      config,
      "E:/workspace",
      createModelProvider(),
      {
        scenarioSource: new VerificationScenarioSource(),
        embedding: { model: "embedding-test", client: { embed } },
        availableExecutionTargets: () => ["Local"],
      },
    );

    await runtime.search({ query: "查找归档能力" });
    tools[0] = createMutableTool("Find records using the updated semantic description.");
    await runtime.search({ query: "查找更新能力" });

    expect(embed).toHaveBeenCalledTimes(4);
    expect(embed.mock.calls[0]?.[0].input[0]).toContain("original archive description");
    expect(embed.mock.calls[2]?.[0].input[0]).toContain("updated semantic description");
    await runtime.close();
  });

  test("reuses persisted document vectors after a runtime restart", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-tool-search-cache-"));
    const cacheStore = new AgentCapabilityEmbeddingFileStore(
      resolveAgentWorkspaceLayout(workspaceRoot).caches.toolSearchEmbeddings,
    );
    const config = createToolSearchConfig();
    config.Embedding.Enabled = true;
    const tools = [createMutableTool("Search the original archive description.")];

    const firstEmbed = vi.fn(async ({ input }: { input: readonly string[] }) => ({
      model: "embedding-test",
      vectors: input.map(() => [1, 0]),
    }));
    const firstRuntime = createRuntime(workspaceRoot, tools, cacheStore, firstEmbed, config);
    await firstRuntime.search({ query: "查找归档能力" });
    await firstRuntime.close();

    expect(fs.existsSync(resolveAgentWorkspaceLayout(workspaceRoot).caches.toolSearchEmbeddings)).toBe(true);

    const secondEmbed = vi.fn(async ({ input }: { input: readonly string[] }) => ({
      model: "embedding-test",
      vectors: input.map(() => [1, 0]),
    }));
    const secondRuntime = createRuntime(workspaceRoot, tools, cacheStore, secondEmbed, config);
    await secondRuntime.search({ query: "查找归档能力" });

    expect(secondEmbed).toHaveBeenCalledTimes(1);
    expect(secondEmbed.mock.calls[0]?.[0].input).toEqual(["查找归档能力"]);
    await secondRuntime.close();
  });
});

function createRuntime(
  workspaceRoot: string,
  tools: ReturnType<typeof createMutableTool>[],
  cacheStore: AgentCapabilityEmbeddingFileStore,
  embed: (request: AgentEmbeddingRequest) => Promise<AgentEmbeddingResult>,
  config = createToolSearchConfig(),
) {
  return new AgentToolSearchRuntime(
    createRegistry(tools) as unknown as AgentExtensionRegistry,
    config,
    workspaceRoot,
    createModelProvider(),
    {
      scenarioSource: new VerificationScenarioSource(),
      embedding: { model: "embedding-test", client: { embed } },
      embeddingCacheStore: cacheStore,
      availableExecutionTargets: () => ["Local"],
    },
  );
}

function createMutableTool(summary: string) {
  return createTool({
    name: "MutableSearchTool",
    title: "Mutable search",
    summary,
    tags: ["search"],
    actions: ["search"],
    targets: ["archive"],
    priority: 20,
  });
}

function createCapabilityDocument(name: string, semanticText: string): AgentCapabilitySearchDocument {
  return {
    id: name,
    kind: AgentCapabilityKinds.Tool,
    name,
    revision: "1",
    title: name,
    owner: "test",
    sourceText: "",
    tags: "",
    summary: semanticText,
    useCases: "",
    examples: "",
    capabilityText: "",
    capabilityFacets: "",
    parameters: "",
    fuzzyText: name,
    semanticInputs: [{ id: "primary", text: semanticText }],
    semanticText,
  };
}

function createCapabilityDocumentWithViews(
  name: string,
  primaryText: string,
  auxiliaryText: string,
): AgentCapabilitySearchDocument {
  return {
    ...createCapabilityDocument(name, primaryText),
    semanticInputs: [
      { id: "primary", text: primaryText },
      { id: "auxiliary", text: auxiliaryText },
    ],
    semanticText: `${primaryText}\n${auxiliaryText}`,
  };
}
