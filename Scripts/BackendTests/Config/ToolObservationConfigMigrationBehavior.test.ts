import { describe, expect, test } from "vitest";
import { migrateAgentConfigPayload } from "../../../Source/AgentSystem/Config/AgentConfigMigration.js";
import { CurrentAgentConfigVersion } from "../../../Source/AgentSystem/Config/AgentConfigVersion.js";

describe("tool observation configuration migration", () => {
  test("retires the old inline threshold instead of mapping it to the global observation cap", () => {
    const migrated = migrateAgentConfigPayload({
      ConfigVersion: 29,
      Artifacts: {
        RootDir: ".senera/artifacts",
        InlineResultMaxTokens: 2_048,
        InlineResultMaxBytes: 16_384,
      },
      Defaults: {
        Artifacts: {
          InlineResultMaxTokens: 2_048,
          InlineResultMaxBytes: 16_384,
        },
      },
    });

    expect(migrated).toEqual({
      sourceVersion: 29,
      targetVersion: CurrentAgentConfigVersion,
      migratedPaths: ["ConfigVersion"],
      removedPaths: [
        "Artifacts.InlineResultMaxTokens",
        "Artifacts.InlineResultMaxBytes",
        "Defaults.Artifacts.InlineResultMaxTokens",
        "Defaults.Artifacts.InlineResultMaxBytes",
      ],
      config: {
        ConfigVersion: CurrentAgentConfigVersion,
        Artifacts: { RootDir: ".senera/artifacts" },
        Defaults: { Artifacts: {} },
      },
    });
  });

  test("preserves an explicitly configured global observation cap", () => {
    const migrated = migrateAgentConfigPayload({
      ConfigVersion: 29,
      Artifacts: { ToolObservationMaxTokens: 12_000, InlineResultMaxTokens: 2_048 },
    });

    expect(migrated?.config).toMatchObject({
      ConfigVersion: CurrentAgentConfigVersion,
      Artifacts: { ToolObservationMaxTokens: 12_000 },
    });
    expect(migrated?.removedPaths).toContain("Artifacts.InlineResultMaxTokens");
  });
});
