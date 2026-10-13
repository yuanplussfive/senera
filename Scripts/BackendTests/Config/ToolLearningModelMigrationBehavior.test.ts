import { describe, expect, test } from "vitest";
import { migrateAgentConfigPayload } from "../../../Source/AgentSystem/Config/AgentConfigMigration.js";
import { CurrentAgentConfigVersion } from "../../../Source/AgentSystem/Config/AgentConfigVersion.js";

describe("retired tool learning configuration migration", () => {
  test("removes the retired tool learning configuration from a v31 payload", () => {
    const migrated = migrateAgentConfigPayload({
      ConfigVersion: 31,
      ModelProviders: [],
      ToolLearning: {
        Enabled: true,
        Client: { ModelProviderId: "chat-a", Temperature: 0.2 },
        MaxRepairAttempts: 2,
      },
    });

    expect(migrated?.targetVersion).toBe(CurrentAgentConfigVersion);
    expect(migrated?.config).not.toHaveProperty("ToolLearning");
    expect(migrated?.removedPaths).toContain("ToolLearning");
  });

  test("removes the retired tool learning configuration from Defaults", () => {
    const migrated = migrateAgentConfigPayload({
      ConfigVersion: 31,
      ModelProviders: [],
      Defaults: {
        ToolLearning: {
          Enabled: false,
          Client: { ModelProviderId: "chat-a" },
          MaxRepairAttempts: 1,
        },
      },
    });

    expect(migrated?.config).not.toHaveProperty("Defaults.ToolLearning");
    expect(migrated?.removedPaths).toContain("Defaults.ToolLearning");
  });
});
