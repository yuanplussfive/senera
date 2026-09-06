import Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";
import { AgentConfigService } from "../../../Source/AgentSystem/Config/AgentConfigService.js";
import { migrateAgentConfigPayload } from "../../../Source/AgentSystem/Config/AgentConfigMigration.js";
import { CurrentAgentConfigVersion } from "../../../Source/AgentSystem/Config/AgentConfigVersion.js";
import { AgentConfigSqliteRepository } from "../../../Source/AgentSystem/Config/AgentConfigSqliteRepository.js";
import { resolveAgentWorkspaceLayout } from "../../../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import { AgentSystemConfigSchema } from "../../../Source/AgentSystem/Schemas/AgentSystemConfigSchema.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const temporaryDirectories: string[] = [];
const sqliteAvailable = canOpenNativeSqlite();

afterEach(() => {
  while (temporaryDirectories.length > 0) removeDirectory(temporaryDirectories.pop()!);
});

describe("retired plugin configuration migration", () => {
  test("removes plugin roots and discovery settings from the runtime and defaults", () => {
    const migrated = migrateAgentConfigPayload({
      ConfigVersion: 21,
      PluginRoots: { System: ["./System/Plugins"], User: ["./Plugins"] },
      PluginDiscovery: { ManifestFileName: "PluginManifest.json", ConfigFileName: "PluginConfig.toml" },
      Defaults: {
        PluginRoots: { System: ["./System/Plugins"] },
        PluginDiscovery: { ManifestFileName: "PluginManifest.json" },
      },
      ModelProviders: [modelProvider()],
    });

    expect(migrated).toEqual({
      sourceVersion: 21,
      targetVersion: CurrentAgentConfigVersion,
      migratedPaths: ["ConfigVersion"],
      removedPaths: ["PluginRoots", "PluginDiscovery", "Defaults.PluginRoots", "Defaults.PluginDiscovery"],
      config: {
        ConfigVersion: CurrentAgentConfigVersion,
        Defaults: {},
        ModelProviders: [modelProvider()],
      },
    });
    expect(AgentSystemConfigSchema.safeParse(migrated?.config).success).toBe(true);
  });

  test("renames plugin documentation and drops the retired prompt XML settings", () => {
    const migrated = migrateAgentConfigPayload({
      ConfigVersion: 21,
      PluginDocumentation: {
        Markdown: { MinNonEmptyLines: 2, ExcludePathFragments: ["node_modules"] },
        ToolDescription: {
          MinNonEmptyLines: 3,
          SummarySection: "Summary",
          TriggerSection: "Triggers",
          AvoidSection: "Avoid",
          RequiredSections: ["Summary", "Triggers"],
        },
        PromptXml: { XmlFenceLanguages: ["xml"], CodeFenceLanguages: ["json"] },
      },
      ModelProviders: [modelProvider()],
    });

    expect(migrated).toEqual({
      sourceVersion: 21,
      targetVersion: CurrentAgentConfigVersion,
      migratedPaths: ["ToolDocumentation", "ConfigVersion"],
      removedPaths: ["PluginDocumentation.PromptXml", "PluginDocumentation"],
      config: {
        ConfigVersion: CurrentAgentConfigVersion,
        ToolDocumentation: {
          Markdown: { MinNonEmptyLines: 2, ExcludePathFragments: ["node_modules"] },
          ToolDescription: {
            MinNonEmptyLines: 3,
            SummarySection: "Summary",
            TriggerSection: "Triggers",
            AvoidSection: "Avoid",
            RequiredSections: ["Summary", "Triggers"],
          },
        },
        ModelProviders: [modelProvider()],
      },
    });
    expect(AgentSystemConfigSchema.safeParse(migrated?.config).success).toBe(true);
  });

  test("cleans obsolete prompt XML settings from an already renamed document block", () => {
    const migrated = migrateAgentConfigPayload({
      ConfigVersion: 21,
      ToolDocumentation: {
        ToolDescription: {
          MinNonEmptyLines: 3,
          SummarySection: "Summary",
          TriggerSection: "Triggers",
          AvoidSection: "Avoid",
          RequiredSections: ["Summary", "Triggers"],
        },
        PromptXml: { XmlFenceLanguages: ["xml"] },
      },
      ModelProviders: [modelProvider()],
    });

    expect(migrated).toMatchObject({
      sourceVersion: 21,
      targetVersion: CurrentAgentConfigVersion,
      migratedPaths: ["ConfigVersion"],
      removedPaths: ["ToolDocumentation.PromptXml"],
      config: {
        ConfigVersion: CurrentAgentConfigVersion,
        ToolDocumentation: {
          ToolDescription: {
            MinNonEmptyLines: 3,
            SummarySection: "Summary",
            TriggerSection: "Triggers",
            AvoidSection: "Avoid",
            RequiredSections: ["Summary", "Triggers"],
          },
        },
        ModelProviders: [modelProvider()],
      },
    });
    expect(AgentSystemConfigSchema.safeParse(migrated?.config).success).toBe(true);
  });

  test.skipIf(!sqliteAvailable)("repairs a legacy SQLite revision before strict validation", () => {
    const workspaceRoot = createTemporaryDirectory("senera-plugin-config-migration");
    temporaryDirectories.push(workspaceRoot);
    const databasePath = resolveAgentWorkspaceLayout(workspaceRoot).databases.config;
    const writer = new AgentConfigSqliteRepository(databasePath);
    writer.appendRevision({
      config: legacyPluginConfig() as unknown as AgentSystemConfig,
      source: "json_import",
    });
    writer.close();

    const service = new AgentConfigService({
      workspaceRoot,
      source: {
        kind: "sqlite",
        databasePath,
        seedConfig: { ModelProviders: [modelProvider()] },
      },
    });
    try {
      const snapshot = service.snapshot();
      expect(snapshot.revision).toBe(2);
      expect(snapshot.value.ConfigVersion).toBe(CurrentAgentConfigVersion);
      expect(snapshot.value.Defaults).toEqual({});
      expect(snapshot.diagnostics[0]?.severity).toBe("warning");
    } finally {
      service.close();
    }

    const repository = new AgentConfigSqliteRepository(databasePath);
    try {
      expect(repository.latestRevision()?.source).toBe("migration");
      expect(repository.latestRevision()?.config.Defaults).toEqual({});
    } finally {
      repository.close();
    }
  });
});

function modelProvider() {
  return {
    Id: "test",
    ProviderId: "test-endpoint",
    Endpoint: "ChatCompletions" as const,
    Model: "test-model",
  };
}

function legacyPluginConfig(): Record<string, unknown> {
  return {
    ConfigVersion: 5,
    Defaults: {
      PluginRoots: { System: ["./System/Plugins"], User: ["./Plugins"] },
      PluginDiscovery: { ManifestFileName: "PluginManifest.json", ConfigFileName: "PluginConfig.toml" },
    },
    ModelProviders: [modelProvider()],
  };
}

function canOpenNativeSqlite(): boolean {
  try {
    const database = new Database(":memory:");
    database.close();
    return true;
  } catch {
    return false;
  }
}
