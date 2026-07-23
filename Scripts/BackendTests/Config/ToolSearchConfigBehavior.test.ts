import { describe, expect, test } from "vitest";
import { resolveToolSearchConfig } from "../../../Source/AgentSystem/AgentDefaults.js";
import {
  ToolSearchSchema,
  VectorModelsSchema,
} from "../../../Source/AgentSystem/Schemas/AgentToolMemoryConfigSchema.js";
import { migrateAgentConfigPayload } from "../../../Source/AgentSystem/Config/AgentConfigMigration.js";
import { CurrentAgentConfigVersion } from "../../../Source/AgentSystem/Config/AgentConfigVersion.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

describe("tool search configuration", () => {
  test("accepts unbounded vector model limits and rejects zero", () => {
    expect(
      VectorModelsSchema.safeParse({
        Embedding: { InputMaxChars: -1 },
        Rerank: { CandidateLimit: -1, TopK: -1 },
      }).success,
    ).toBe(true);
    expect(VectorModelsSchema.safeParse({ Rerank: { CandidateLimit: 0 } }).success).toBe(false);
    expect(VectorModelsSchema.safeParse({ Rerank: { TopK: 0 } }).success).toBe(false);
  });

  test.each(["disabled", "fallback", "augment"] as const)("accepts memory expansion mode %s", (mode) => {
    expect(
      ToolSearchSchema.safeParse({
        Ranking: {
          MaxResults: 6,
          MemoryExpansion: {
            Mode: mode,
            MinConfidence: 0.8,
            MinEvidence: 3,
            MaxResults: 2,
          },
        },
      }).success,
    ).toBe(true);
  });

  test.each([
    { Memory: { Kind: "memory" } },
    { Ranking: { MaxResults: 0 } },
    { Ranking: { MemoryExpansion: { Mode: "unknown" } } },
    { Ranking: { MemoryExpansion: { MinConfidence: 1.1 } } },
    { Ranking: { MemoryExpansion: { MinEvidence: -1 } } },
    { Ranking: { MemoryExpansion: { MaxResults: 0 } } },
    { Ranking: { IntentGate: { Mode: "side_effect_capability" } } },
  ])("rejects invalid bounded retrieval policy %#", (value) => {
    expect(ToolSearchSchema.safeParse(value).success).toBe(false);
  });

  test("deeply merges default and runtime memory expansion policy", () => {
    const resolved = resolveToolSearchConfig(
      config({
        Defaults: {
          ToolSearch: {
            Ranking: {
              MemoryExpansion: {
                MinEvidence: 5,
              },
            },
          },
        },
        ToolSearch: {
          Ranking: {
            MemoryExpansion: {
              Mode: "augment",
            },
          },
        },
      }),
    );

    expect(resolved.Ranking).toMatchObject({
      MaxResults: 6,
      MemoryExpansion: {
        Mode: "augment",
        MinConfidence: 0.8,
        MinEvidence: 5,
        MaxResults: 2,
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
      removedPaths: ["ToolSearch.Memory.Kind", "Defaults.ToolSearch.Memory.Kind"],
      config: {
        ConfigVersion: CurrentAgentConfigVersion,
        ToolSearch: { Memory: { DatabasePath: ".senera/tools.sqlite" } },
        Defaults: { ToolSearch: { Memory: { MaxEpisodes: 500 } } },
      },
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
