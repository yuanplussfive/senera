import { describe, expect, test } from "vitest";
import { migrateAgentConfigPayload } from "../../../Source/AgentSystem/Config/AgentConfigMigration.js";
import { CurrentAgentConfigVersion } from "../../../Source/AgentSystem/Config/AgentConfigVersion.js";

describe("workspace receipt configuration migration", () => {
  test("retires observer configuration at both configuration scopes", () => {
    const migrated = migrateAgentConfigPayload({
      ConfigVersion: 28,
      ModelProviders: [],
      Artifacts: {
        RootDir: ".senera/artifacts",
        WorkspaceObserver: { IgnoreDirectoryNames: ["generated"] },
      },
      Defaults: {
        Artifacts: {
          WorkspaceObserver: { IgnoreDirectoryNames: ["node_modules"] },
        },
      },
    });

    expect(migrated).toEqual({
      sourceVersion: 28,
      targetVersion: CurrentAgentConfigVersion,
      migratedPaths: ["ConfigVersion"],
      removedPaths: ["Artifacts.WorkspaceObserver", "Defaults.Artifacts.WorkspaceObserver"],
      config: {
        ConfigVersion: CurrentAgentConfigVersion,
        ModelProviders: [],
        Artifacts: { RootDir: ".senera/artifacts" },
        Defaults: { Artifacts: {} },
      },
    });
  });

  test("retires legacy persona fields without touching the remaining prompt settings", () => {
    const migrated = migrateAgentConfigPayload({
      ConfigVersion: 36,
      Prompt: { CorePersona: "旧人设", LanguageStyle: "旧风格", TimeZone: "Asia/Shanghai" },
      Defaults: { Prompt: { CorePersona: "旧默认人设", LanguageStyle: "旧默认风格" } },
    });

    expect(migrated?.removedPaths).toEqual([
      "Prompt.CorePersona",
      "Prompt.LanguageStyle",
      "Defaults.Prompt.CorePersona",
      "Defaults.Prompt.LanguageStyle",
      "Defaults.Prompt",
    ]);
    expect(migrated?.config).toEqual({
      ConfigVersion: CurrentAgentConfigVersion,
      Prompt: { TimeZone: "Asia/Shanghai" },
      Defaults: {},
    });
  });
});
