import { describe, expect, test } from "vitest";
import { migrateAgentConfigPayload } from "../../../Source/AgentSystem/Config/AgentConfigMigration.js";
import { CurrentAgentConfigVersion } from "../../../Source/AgentSystem/Config/AgentConfigVersion.js";

describe("continuity learning configuration migration", () => {
  test("renames legacy memory learning settings and removes candidate promotion tuning", () => {
    expect(
      migrateAgentConfigPayload({
        ConfigVersion: 12,
        MemoryLearning: {
          Enabled: true,
          Client: { ModelProviderId: "planner" },
          Promotion: { MinSupport: 2, MinSimilarity: 0.8, MaxClusterSize: 5 },
        },
        Defaults: {
          MemoryLearning: {
            Enabled: false,
            Promotion: { MinSupport: 3 },
          },
        },
      }),
    ).toEqual({
      sourceVersion: 12,
      targetVersion: CurrentAgentConfigVersion,
      migratedPaths: ["ContinuityLearning", "Defaults.ContinuityLearning", "ConfigVersion"],
      removedPaths: [
        "MemoryLearning.Promotion",
        "MemoryLearning",
        "Defaults.MemoryLearning.Promotion",
        "Defaults.MemoryLearning",
      ],
      config: {
        ConfigVersion: CurrentAgentConfigVersion,
        ContinuityLearning: {
          Enabled: true,
          Client: { ModelProviderId: "planner" },
        },
        Defaults: { ContinuityLearning: { Enabled: false } },
      },
    });
  });

  test("keeps explicit continuity settings while retiring its obsolete promotion block", () => {
    expect(
      migrateAgentConfigPayload({
        ConfigVersion: 12,
        ContinuityLearning: { Enabled: true, Promotion: { MinSupport: 2 } },
      }),
    ).toMatchObject({
      removedPaths: ["ContinuityLearning.Promotion"],
      config: {
        ConfigVersion: CurrentAgentConfigVersion,
        ContinuityLearning: { Enabled: true },
      },
    });
  });

  test("removes retired extraction retries and token limits from existing continuity settings", () => {
    expect(
      migrateAgentConfigPayload({
        ConfigVersion: 13,
        ContinuityLearning: { MaxRepairAttempts: 3, Client: { MaxTokens: 160, Temperature: 0.2 } },
        Defaults: { ContinuityLearning: { MaxRepairAttempts: 2, Client: { MaxTokens: 80 } } },
      }),
    ).toMatchObject({
      removedPaths: [
        "ContinuityLearning.MaxRepairAttempts",
        "ContinuityLearning.Client.MaxTokens",
        "Defaults.ContinuityLearning.MaxRepairAttempts",
        "Defaults.ContinuityLearning.Client.MaxTokens",
      ],
      config: {
        ConfigVersion: CurrentAgentConfigVersion,
        ContinuityLearning: { Client: { Temperature: 0.2 } },
        Defaults: { ContinuityLearning: { Client: {} } },
      },
    });
  });

  test("removes the character threshold when upgrading the learning gate", () => {
    expect(
      migrateAgentConfigPayload({
        ConfigVersion: 14,
        ContinuityLearning: {
          LearningGate: { Enabled: true, MinimumUserCharacters: 5, DeferredDelaySeconds: 30 },
        },
        Defaults: {
          ContinuityLearning: { LearningGate: { MinimumUserCharacters: 8 } },
        },
      }),
    ).toMatchObject({
      removedPaths: [
        "ContinuityLearning.LearningGate.MinimumUserCharacters",
        "Defaults.ContinuityLearning.LearningGate.MinimumUserCharacters",
      ],
      config: {
        ConfigVersion: CurrentAgentConfigVersion,
        ContinuityLearning: { LearningGate: { Enabled: true, DeferredDelaySeconds: 30 } },
        Defaults: { ContinuityLearning: { LearningGate: {} } },
      },
    });
  });

  test("moves the legacy phrase gate enablement and removes its obsolete node", () => {
    expect(
      migrateAgentConfigPayload({
        ConfigVersion: 16,
        ContinuityLearning: {
          Recall: { TrivialPromptGate: { Enabled: false, Phrases: ["收到"], LearnedThreshold: 2 } },
        },
      }),
    ).toMatchObject({
      sourceVersion: 16,
      targetVersion: CurrentAgentConfigVersion,
      migratedPaths: ["ContinuityLearning.Recall.TurnValueClassifier.Enabled", "ConfigVersion"],
      removedPaths: ["ContinuityLearning.Recall.TrivialPromptGate"],
      config: {
        ConfigVersion: CurrentAgentConfigVersion,
        ContinuityLearning: { Recall: { TurnValueClassifier: { Enabled: false } } },
      },
    });
  });

  test("retires model query rewriting and preserves its semantic timeout", () => {
    expect(
      migrateAgentConfigPayload({
        ConfigVersion: 19,
        ContinuityLearning: {
          Recall: {
            Semantic: { Enabled: true },
            Auxiliary: {
              Enabled: true,
              ModelProviderId: "rewrite-model",
              TimeoutMs: 12_000,
              QueryRewrite: { Enabled: true },
            },
          },
        },
        Defaults: {
          ContinuityLearning: {
            Recall: { Auxiliary: { TimeoutMs: 8_000 } },
          },
        },
      }),
    ).toMatchObject({
      sourceVersion: 19,
      targetVersion: CurrentAgentConfigVersion,
      migratedPaths: [
        "ContinuityLearning.Recall.Semantic.TimeoutMs",
        "Defaults.ContinuityLearning.Recall.Semantic.TimeoutMs",
        "ConfigVersion",
      ],
      removedPaths: ["ContinuityLearning.Recall.Auxiliary", "Defaults.ContinuityLearning.Recall.Auxiliary"],
      config: {
        ConfigVersion: CurrentAgentConfigVersion,
        ContinuityLearning: { Recall: { Semantic: { Enabled: true, TimeoutMs: 12_000 } } },
        Defaults: { ContinuityLearning: { Recall: { Semantic: { TimeoutMs: 8_000 } } } },
      },
    });
  });

  test("retires the time-threshold conversation boundary", () => {
    expect(
      migrateAgentConfigPayload({
        ConfigVersion: 20,
        ContinuityLearning: { TemporalMemory: { Enabled: true, SegmentIdleSeconds: 900 } },
        Defaults: { ContinuityLearning: { TemporalMemory: { SegmentIdleSeconds: 300 } } },
      }),
    ).toMatchObject({
      sourceVersion: 20,
      targetVersion: CurrentAgentConfigVersion,
      removedPaths: [
        "ContinuityLearning.TemporalMemory.SegmentIdleSeconds",
        "Defaults.ContinuityLearning.TemporalMemory.SegmentIdleSeconds",
      ],
      config: {
        ConfigVersion: CurrentAgentConfigVersion,
        ContinuityLearning: { TemporalMemory: { Enabled: true } },
        Defaults: { ContinuityLearning: { TemporalMemory: {} } },
      },
    });
  });
});
