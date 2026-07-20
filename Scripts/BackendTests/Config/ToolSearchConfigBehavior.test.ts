import { describe, expect, test } from "vitest";
import { resolveToolSearchConfig } from "../../../Source/AgentSystem/AgentDefaults.js";
import { ToolSearchSchema } from "../../../Source/AgentSystem/Schemas/AgentToolMemoryConfigSchema.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

describe("tool search configuration", () => {
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

  test.each(["disabled", "side_effect_capability"] as const)("accepts intent gate mode %s", (mode) => {
    expect(ToolSearchSchema.safeParse({ Ranking: { IntentGate: { Mode: mode } } }).success).toBe(true);
  });

  test.each([
    { Ranking: { MaxResults: 0 } },
    { Ranking: { MemoryExpansion: { Mode: "unknown" } } },
    { Ranking: { MemoryExpansion: { MinConfidence: 1.1 } } },
    { Ranking: { MemoryExpansion: { MinEvidence: -1 } } },
    { Ranking: { MemoryExpansion: { MaxResults: 0 } } },
    { Ranking: { IntentGate: { Mode: "unknown" } } },
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
      IntentGate: {
        Mode: "side_effect_capability",
      },
      MemoryExpansion: {
        Mode: "augment",
        MinConfidence: 0.8,
        MinEvidence: 5,
        MaxResults: 2,
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
