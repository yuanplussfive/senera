import { describe, expect, test } from "vitest";
import { migrateAgentConfigPayload } from "../../../Source/AgentSystem/Config/AgentConfigMigration.js";
import { CurrentAgentConfigVersion } from "../../../Source/AgentSystem/Config/AgentConfigVersion.js";

describe("runtime update configuration migration", () => {
  test("removes retired update source settings from runtime and defaults", () => {
    expect(
      migrateAgentConfigPayload({
        ConfigVersion: 11,
        Updates: { Source: "github" },
        Defaults: { Updates: { Source: "github" } },
      }),
    ).toEqual({
      sourceVersion: 11,
      targetVersion: CurrentAgentConfigVersion,
      migratedPaths: ["ConfigVersion"],
      removedPaths: ["Updates", "Defaults.Updates"],
      config: {
        ConfigVersion: CurrentAgentConfigVersion,
        Defaults: {},
      },
    });
  });
});
