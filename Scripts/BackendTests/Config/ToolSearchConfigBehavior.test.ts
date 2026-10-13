import { describe, expect, test } from "vitest";
import { resolveToolSearchConfig } from "../../../Source/AgentSystem/AgentDefaults.js";
import { ToolSearchSchema } from "../../../Source/AgentSystem/Schemas/AgentToolMemoryConfigSchema.js";
import { migrateAgentConfigPayload } from "../../../Source/AgentSystem/Config/AgentConfigMigration.js";
import { CurrentAgentConfigVersion } from "../../../Source/AgentSystem/Config/AgentConfigVersion.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

describe("tool search configuration", () => {
  test("uses one fused policy with a model-aware disclosure budget", () => {
    expect(ToolSearchSchema.safeParse({ Disclosure: { TokenBudget: 640 } }).success).toBe(true);
    expect(ToolSearchSchema.safeParse({ Disclosure: { TokenBudget: 0 } }).success).toBe(false);
    expect(ToolSearchSchema.safeParse({ Ranking: { MemoryExpansion: { Mode: "fallback" } } }).success).toBe(false);
  });

  test("keeps local semantic retrieval free of encoder-calibrated score floors", () => {
    expect(
      ToolSearchSchema.safeParse({
        Embedding: { Enabled: true },
      }).success,
    ).toBe(true);
    expect(
      ToolSearchSchema.safeParse({
        Embedding: { Enabled: true, ScoreThreshold: 0.35 },
      }).success,
    ).toBe(false);
    expect(
      ToolSearchSchema.safeParse({
        Embedding: { Model: "duplicate-model-setting" },
      }).success,
    ).toBe(false);
    expect(ToolSearchSchema.safeParse({ Embedding: { Provider: "local" } }).success).toBe(false);
    expect(ToolSearchSchema.safeParse({ Embedding: { Languages: ["zh", "en"] } }).success).toBe(false);
    expect(resolveToolSearchConfig(config()).Embedding.Enabled).toBe(true);
    // The deterministic reranker is part of local retrieval policy, not a
    // retired remote vector transport. It stays enabled by default while the
    // schema intentionally rejects transport/model fields here.
    expect(resolveToolSearchConfig(config()).Rerank.Enabled).toBe(true);
  });

  test("enables the builtin semantic retrieval channel by default", () => {
    const resolved = resolveToolSearchConfig(config());

    expect(resolved.Embedding).toEqual({ Enabled: true });
    expect(resolved.Tokenize.Stopwords.length).toBeGreaterThan(0);
    expect(resolved.Ranking.ChannelWeights).toMatchObject({
      bm25: 1,
      exact: 0.9,
      example: 1.1,
      fuzzy: 0.7,
      semantic: 0.5,
      structural: 1,
      memory: 0.6,
    });
  });

  test("resolves local fuzzy recovery independently from model services", () => {
    expect(ToolSearchSchema.safeParse({ Fuzzy: { Enabled: true, MinScore: 0.8 } }).success).toBe(true);
    expect(ToolSearchSchema.safeParse({ Fuzzy: { MinScore: 1.1 } }).success).toBe(false);
    expect(ToolSearchSchema.safeParse({ Fuzzy: { CandidateLimit: 4 } }).success).toBe(false);

    expect(
      resolveToolSearchConfig(
        config({
          Defaults: { ToolSearch: { Fuzzy: { Enabled: false } } },
          ToolSearch: { Fuzzy: { MinScore: 0.8 } },
        }),
      ).Fuzzy,
    ).toEqual({ Enabled: false, MinScore: 0.8 });
  });

  test("migrates the retired remote VectorModels transport out of runtime and default settings", () => {
    const migrated = migrateAgentConfigPayload({
      ConfigVersion: 21,
      VectorModels: {
        Embedding: { Enabled: true, ProviderId: "openai", Model: "embedding-model" },
        Rerank: { Enabled: true, ProviderId: "openai", Model: "rerank-model" },
      },
      Defaults: {
        VectorModels: {
          Embedding: { Enabled: true, ProviderId: "openai", Model: "embedding-model" },
        },
      },
    });

    expect(migrated).toMatchObject({
      sourceVersion: 21,
      targetVersion: CurrentAgentConfigVersion,
      removedPaths: ["VectorModels", "Defaults.VectorModels"],
      config: {
        ConfigVersion: CurrentAgentConfigVersion,
      },
    });
    expect(migrated?.config).not.toHaveProperty("VectorModels");
    expect(migrated?.config).not.toHaveProperty("Defaults.VectorModels");
    expect(migrated?.removedPaths).toHaveLength(2);
  });

  test("preserves model and endpoint identities while stripping retired vector capability bits", () => {
    const migrated = migrateAgentConfigPayload({
      ConfigVersion: 22,
      ModelProviders: [
        {
          Id: "main-assistant",
          ProviderId: "main",
          Capabilities: { Chat: true, Embedding: true, Vision: true, Rerank: true },
        },
        {
          Id: "emb/qwen3-embedding-0.6b",
          ProviderId: "emb",
          Endpoint: "ChatCompletions",
          Model: "qwen3-embedding-0.6b",
        },
        { Id: "emb/qwen3-reranker-0.6b", ProviderId: "emb", Endpoint: "ChatCompletions", Model: "qwen3-reranker-0.6b" },
        { Id: "kept", ProviderId: "main" },
      ],
      ModelProviderEndpoints: [
        { Id: "main", Enabled: true },
        { Id: "emb", Enabled: true, BaseUrl: "http://154.21.196.246:3000/v1" },
        { Id: "openai", Enabled: true },
      ],
    });

    expect(migrated?.targetVersion).toBe(CurrentAgentConfigVersion);
    expect(migrated?.config).toMatchObject({
      ConfigVersion: CurrentAgentConfigVersion,
      ModelProviders: [
        { Id: "main-assistant", Capabilities: { Chat: true, Vision: true } },
        { Id: "emb/qwen3-embedding-0.6b", ProviderId: "emb" },
        { Id: "emb/qwen3-reranker-0.6b", ProviderId: "emb" },
        { Id: "kept" },
      ],
      ModelProviderEndpoints: [{ Id: "main" }, { Id: "emb" }, { Id: "openai" }],
    });
    const providerRows = (migrated?.config as { ModelProviders?: unknown[] })?.ModelProviders;
    const endpointRows = (migrated?.config as { ModelProviderEndpoints?: unknown[] })?.ModelProviderEndpoints;
    expect(providerRows).toHaveLength(4);
    expect(endpointRows).toHaveLength(3);
    expect(endpointRows).toContainEqual(expect.objectContaining({ Id: "emb" }));
    expect(migrated?.removedPaths).toEqual([
      "ModelProviders[0].Capabilities.Embedding",
      "ModelProviders[0].Capabilities.Rerank",
    ]);
  });

  test("migrates the retired character-based artifact summary ceiling", () => {
    const migrated = migrateAgentConfigPayload({
      ConfigVersion: 23,
      Artifacts: {
        RootDir: ".senera/artifacts/runs",
        SummaryMaxChars: 2400,
        RawJsonMaxBytes: 67_108_864,
      },
      Defaults: {
        Artifacts: { SummaryMaxChars: 1200 },
      },
    });

    expect(migrated).toMatchObject({
      sourceVersion: 23,
      targetVersion: CurrentAgentConfigVersion,
      removedPaths: ["Artifacts.SummaryMaxChars", "Defaults.Artifacts.SummaryMaxChars"],
      config: {
        ConfigVersion: CurrentAgentConfigVersion,
        Artifacts: { RootDir: ".senera/artifacts/runs", RawJsonMaxBytes: 67_108_864 },
        Defaults: { Artifacts: {} },
      },
    });
  });

  test.each([
    { Memory: { Kind: "memory" } },
    { Fuzzy: { CandidateLimit: 1 } },
    { Ranking: { MmrLambda: 0.7 } },
    { Rerank: { CandidateLimit: 12 } },
    { Ranking: { IntentGate: { Mode: "side_effect_capability" } } },
  ])("rejects invalid bounded retrieval policy %#", (value) => {
    expect(ToolSearchSchema.safeParse(value).success).toBe(false);
  });

  test("deeply merges default and runtime disclosure policy", () => {
    const resolved = resolveToolSearchConfig(
      config({
        Defaults: {
          ToolSearch: {
            Disclosure: {
              TokenBudget: 512,
            },
          },
        },
        ToolSearch: {
          Disclosure: {
            TokenBudget: 768,
          },
        },
      }),
    );

    expect(resolved.Disclosure).toEqual({ TokenBudget: 768 });
  });

  test("migrates retired fixed discovery limits from runtime and default settings", () => {
    const migrated = migrateAgentConfigPayload({
      ConfigVersion: 25,
      ToolSearch: {
        Fuzzy: { CandidateLimit: 8 },
        Ranking: { MmrLambda: 0.72, MmrCandidateScoreRatio: 0.92, MinScore: 0, MemoryExpansion: { Mode: "fallback" } },
        Rerank: { CandidateLimit: 24 },
      },
      Defaults: {
        ToolSearch: {
          Fuzzy: { CandidateLimit: 4 },
          Ranking: { MemoryExpansion: { Mode: "augment" } },
          Rerank: { CandidateLimit: 12 },
        },
      },
    });

    expect(migrated).toMatchObject({
      sourceVersion: 25,
      targetVersion: CurrentAgentConfigVersion,
      removedPaths: [
        "ToolSearch.Fuzzy.CandidateLimit",
        "ToolSearch.Ranking.MmrLambda",
        "ToolSearch.Ranking.MmrCandidateScoreRatio",
        "ToolSearch.Ranking.MinScore",
        "ToolSearch.Ranking.MemoryExpansion",
        "ToolSearch.Rerank.CandidateLimit",
        "Defaults.ToolSearch.Fuzzy.CandidateLimit",
        "Defaults.ToolSearch.Ranking.MemoryExpansion",
        "Defaults.ToolSearch.Rerank.CandidateLimit",
      ],
    });
  });

  test("removes retired embedding transport metadata before strict validation", () => {
    const migrated = migrateAgentConfigPayload({
      ConfigVersion: 26,
      ToolSearch: { Embedding: { Enabled: true, Provider: "local", Languages: ["zh", "en"] } },
      Defaults: {
        ToolSearch: { Embedding: { Provider: "local", Languages: ["en"] } },
      },
    });

    expect(migrated).toMatchObject({
      targetVersion: CurrentAgentConfigVersion,
      removedPaths: [
        "ToolSearch.Embedding.Provider",
        "ToolSearch.Embedding.Languages",
        "Defaults.ToolSearch.Embedding.Provider",
        "Defaults.ToolSearch.Embedding.Languages",
      ],
      config: {
        ConfigVersion: CurrentAgentConfigVersion,
        ToolSearch: { Embedding: { Enabled: true } },
        Defaults: { ToolSearch: { Embedding: {} } },
      },
    });
  });

  test("migrates the retired discovery intent gate out of runtime and default settings", () => {
    const migrated = migrateAgentConfigPayload({
      ConfigVersion: 1,
      ToolSearch: { Ranking: { IntentGate: { Mode: "side_effect_capability" } } },
      Defaults: { ToolSearch: { Ranking: { IntentGate: { Mode: "disabled" } } } },
    });

    expect(migrated).toMatchObject({
      sourceVersion: 1,
      targetVersion: CurrentAgentConfigVersion,
      removedPaths: ["ToolSearch.Ranking.IntentGate", "Defaults.ToolSearch.Ranking.IntentGate"],
      config: {
        ConfigVersion: CurrentAgentConfigVersion,
        ToolSearch: { Ranking: {} },
        Defaults: { ToolSearch: { Ranking: {} } },
      },
    });
  });

  test("migrates the retired tool learning storage selector to the SQLite-only contract", () => {
    const migrated = migrateAgentConfigPayload({
      ConfigVersion: 3,
      ToolSearch: { Memory: { Kind: "memory", DatabasePath: ".senera/tools.sqlite" } },
      Defaults: { ToolSearch: { Memory: { Kind: "sqlite", MaxEpisodes: 500 } } },
    });

    expect(migrated).toMatchObject({
      sourceVersion: 3,
      targetVersion: CurrentAgentConfigVersion,
      removedPaths: ["ToolSearch.Memory.Kind", "Defaults.ToolSearch.Memory.Kind", "ToolSearch.Memory.DatabasePath"],
      config: {
        ConfigVersion: CurrentAgentConfigVersion,
        ToolSearch: { Memory: {} },
        Defaults: { ToolSearch: { Memory: { MaxEpisodes: 500 } } },
      },
    });
  });

  test("removes retired ToolSearch embedding transport settings", () => {
    const migrated = migrateAgentConfigPayload({
      ConfigVersion: 8,
      ToolSearch: {
        Embedding: {
          Enabled: true,
          ModelProviderId: "embedding/model",
          Model: "embedding-model",
          Dimensions: 1024,
          BatchSize: 32,
          InputMaxChars: 12000,
          ScoreThreshold: 0.2,
          CandidateThreshold: 0.45,
        },
      },
    });

    expect(migrated).toMatchObject({
      sourceVersion: 8,
      targetVersion: CurrentAgentConfigVersion,
      removedPaths: [
        "ToolSearch.Embedding.ModelProviderId",
        "ToolSearch.Embedding.Model",
        "ToolSearch.Embedding.Dimensions",
        "ToolSearch.Embedding.BatchSize",
        "ToolSearch.Embedding.InputMaxChars",
        "ToolSearch.Embedding.ScoreThreshold",
        "ToolSearch.Embedding.CandidateThreshold",
      ],
      config: {
        ConfigVersion: CurrentAgentConfigVersion,
        ToolSearch: { Embedding: { Enabled: true } },
      },
    });
  });

  test("preserves user model and endpoint identities while removing retired vector capability flags", () => {
    const migrated = migrateAgentConfigPayload({
      ConfigVersion: 22,
      ModelProviders: [
        { Id: "emb/legacy", ProviderId: "emb", Model: "legacy-vector" },
        { Id: "emb/custom-chat", ProviderId: "custom", Model: "custom-chat" },
        {
          Id: "main",
          ProviderId: "main",
          Model: "main-chat",
          Capabilities: { Chat: true, Embedding: true, Rerank: true },
        },
      ],
      ModelProviderEndpoints: [{ Id: "emb" }, { Id: "custom" }, { Id: "main" }],
    });

    expect(migrated).toMatchObject({
      removedPaths: ["ModelProviders[2].Capabilities.Embedding", "ModelProviders[2].Capabilities.Rerank"],
      config: {
        ConfigVersion: CurrentAgentConfigVersion,
        ModelProviders: [
          { Id: "emb/legacy", ProviderId: "emb", Model: "legacy-vector" },
          { Id: "emb/custom-chat", ProviderId: "custom", Model: "custom-chat" },
          { Id: "main", ProviderId: "main", Model: "main-chat", Capabilities: { Chat: true } },
        ],
        ModelProviderEndpoints: [{ Id: "emb" }, { Id: "custom" }, { Id: "main" }],
      },
    });
  });

  test("preserves an unreferenced custom endpoint named emb", () => {
    const migrated = migrateAgentConfigPayload({
      ConfigVersion: 22,
      ModelProviderEndpoints: [{ Id: "emb", BaseUrl: "https://models.example.test/v1" }],
    });

    expect(migrated?.config).toMatchObject({
      ConfigVersion: CurrentAgentConfigVersion,
      ModelProviderEndpoints: [{ Id: "emb", BaseUrl: "https://models.example.test/v1" }],
    });
  });
});

function config(overrides: Partial<AgentSystemConfig> = {}): AgentSystemConfig {
  return {
    ModelProviders: [
      {
        Id: "test",
        ProviderId: "test-endpoint",
        Endpoint: "ChatCompletions",
        Model: "test-model",
      },
    ],
    ...overrides,
  };
}
