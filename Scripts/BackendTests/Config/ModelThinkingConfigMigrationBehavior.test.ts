import { describe, expect, test } from "vitest";
import { migrateAgentConfigPayload } from "../../../Source/AgentSystem/Config/AgentConfigMigration.js";
import { CurrentAgentConfigVersion } from "../../../Source/AgentSystem/Config/AgentConfigVersion.js";

describe("model thinking configuration migration", () => {
  test("removes the retired native thinking map while preserving reasoning profiles", () => {
    const migrated = migrateAgentConfigPayload({
      ConfigVersion: 32,
      ModelProviders: [
        {
          Id: "openai/reasoning",
          ProviderId: "openai",
          Endpoint: "Responses",
          Model: "reasoning-model",
          Capabilities: { Reasoning: true },
          ThinkingLevelMap: { medium: "balanced", high: "deep" },
          ThinkingProfiles: [{ Id: "deep", Label: "深度", Level: "high" }],
        },
      ],
    });

    expect(migrated?.targetVersion).toBe(CurrentAgentConfigVersion);
    expect(migrated?.config).toMatchObject({
      ModelProviders: [
        {
          Id: "openai/reasoning",
          ThinkingProfiles: [{ Id: "deep", Label: "深度", Level: "high" }],
        },
      ],
    });
    expect(migrated?.removedPaths).toContain("ModelProviders[0].ThinkingLevelMap");
  });
});
