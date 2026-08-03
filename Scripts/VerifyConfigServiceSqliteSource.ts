import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AgentConfigService } from "../Source/AgentSystem/Config/AgentConfigService.js";
import { AgentConfigSqliteRepository } from "../Source/AgentSystem/Config/AgentConfigSqliteRepository.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import { CurrentAgentConfigVersion } from "../Source/AgentSystem/Config/AgentConfigVersion.js";
import { resolveAgentWorkspaceLayout } from "../Source/AgentSystem/Core/AgentWorkspaceLayout.js";
import { removeTemporaryWorkspace } from "./Support/TemporaryWorkspace.js";

const tempRoot = path.join(process.cwd(), ".senera", "tmp", "verify-config-service");
fs.mkdirSync(tempRoot, { recursive: true });
const workspaceRoot = fs.mkdtempSync(path.join(tempRoot, "run-"));
const desktopWorkspaceRoot = fs.mkdtempSync(path.join(tempRoot, "desktop-"));
const configPath = path.join(workspaceRoot, "senera.config.json");

let service: AgentConfigService | undefined;
let reloaded: AgentConfigService | undefined;

try {
  const initialConfig: AgentSystemConfig = {
    ConfigStore: {
      Enabled: true,
      MirrorJson: true,
    },
    ModelProviderEndpoints: [
      {
        Id: "default",
        BaseUrl: "https://example.invalid/v1",
        ApiKey: "test",
      },
    ],
    ModelProviders: [
      {
        Id: "default",
        ProviderId: "default",
        Endpoint: "Responses",
        Model: "initial-model",
      },
    ],
  };

  fs.writeFileSync(configPath, `${JSON.stringify(initialConfig, null, 2)}\n`, "utf8");

  service = new AgentConfigService({
    workspaceRoot,
    source: {
      kind: "json",
      configPath,
    },
  });
  const first = service.snapshot();
  assert.equal(first.source, "sqlite");
  assert.equal(first.revision, 1);
  assert.equal(first.value.ConfigVersion, CurrentAgentConfigVersion);
  assert.equal(first.value.ModelProviders[0].Model, "initial-model");
  assert.equal(fs.existsSync(resolveAgentWorkspaceLayout(workspaceRoot).databases.config), true);

  const updatedConfig: AgentSystemConfig = {
    ...first.value,
    DefaultModelProviderId: "default",
    ModelProviderEndpoints: [
      ...(first.value.ModelProviderEndpoints ?? []),
      {
        Id: "secondary",
        BaseUrl: "https://secondary.example.invalid/v1",
        ApiKey: "secondary-key",
      },
    ],
    ModelProviders: [
      {
        ...first.value.ModelProviders[0],
        Model: "updated-model",
      },
      {
        Id: "secondary/secondary-model",
        ProviderId: "secondary",
        Endpoint: "ChatCompletions",
        Model: "secondary-model",
      },
    ],
  };

  const second = service.replaceConfig({
    commandId: "replace-json-config-1",
    baseRevision: first.revision,
    config: updatedConfig,
    source: "ui_update",
  });
  assert.equal(second.source, "sqlite");
  assert.equal(second.revision, 2);
  assert.equal(second.value.ModelProviderEndpoints?.at(-1)?.Id, "secondary");
  assert.equal(second.value.ModelProviders[0].Model, "updated-model");

  const mirrored = JSON.parse(fs.readFileSync(configPath, "utf8")) as AgentSystemConfig;
  assert.equal(mirrored.ModelProviderEndpoints?.at(-1)?.Id, "secondary");
  assert.equal(mirrored.ModelProviders[0].Model, "updated-model");
  assert.equal(mirrored.ModelProviders[1].ProviderId, "secondary");

  service.close();
  service = undefined;

  reloaded = new AgentConfigService({
    workspaceRoot,
    source: {
      kind: "json",
      configPath,
    },
  });
  assert.equal(reloaded.snapshot().revision, 2);
  assert.equal(reloaded.snapshot().value.ModelProviders[0].Model, "updated-model");
  reloaded.close();
  reloaded = undefined;

  const desktopDatabasePath = resolveAgentWorkspaceLayout(desktopWorkspaceRoot).databases.config;
  const desktopSeedConfig: AgentSystemConfig = {
    ModelProviderEndpoints: [
      {
        Id: "desktop",
        BaseUrl: "https://desktop.example.invalid/v1",
        ApiKey: "desktop-key",
      },
    ],
    ModelProviders: [
      {
        Id: "desktop/seed-model",
        ProviderId: "desktop",
        Endpoint: "ChatCompletions",
        Model: "seed-model",
      },
    ],
  };

  service = new AgentConfigService({
    workspaceRoot: desktopWorkspaceRoot,
    source: {
      kind: "sqlite",
      databasePath: desktopDatabasePath,
      seedConfig: desktopSeedConfig,
    },
  });
  assert.equal(service.snapshot().source, "sqlite");
  assert.equal(service.snapshot().revision, 1);
  assert.equal(service.snapshot().value.ModelProviders[0].Model, "seed-model");

  const desktopUpdated = service.replaceConfig({
    commandId: "replace-desktop-config-1",
    baseRevision: service.snapshot().revision,
    config: {
      ...service.snapshot().value,
      DefaultModelProviderId: "desktop/updated-model",
      ModelProviders: [
        {
          ...service.snapshot().value.ModelProviders[0],
          Id: "desktop/updated-model",
          Model: "updated-desktop-model",
        },
      ],
    },
    source: "ui_update",
  });
  assert.equal(desktopUpdated.revision, 2);
  assert.equal(desktopUpdated.value.ModelProviders[0].Model, "updated-desktop-model");
  service.close();
  service = undefined;

  reloaded = new AgentConfigService({
    workspaceRoot: desktopWorkspaceRoot,
    source: {
      kind: "sqlite",
      databasePath: desktopDatabasePath,
      seedConfig: {
        ...desktopSeedConfig,
        ModelProviders: [
          {
            ...desktopSeedConfig.ModelProviders[0],
            Model: "ignored-seed-on-reload",
          },
        ],
      },
    },
  });
  assert.equal(reloaded.snapshot().revision, 2);
  assert.equal(reloaded.snapshot().value.ModelProviders[0].Model, "updated-desktop-model");
  reloaded.close();
  reloaded = undefined;

  service = new AgentConfigService({
    workspaceRoot: desktopWorkspaceRoot,
    source: {
      kind: "sqlite",
      databasePath: desktopDatabasePath,
      seedConfig: desktopSeedConfig,
    },
  });
  const { ConfigVersion: _currentConfigVersion, ...legacyBaseConfig } = service.snapshot().value;
  const legacyConfig = {
    ...legacyBaseConfig,
    Defaults: {
      ...service.snapshot().value.Defaults,
      Cli: {
        Enabled: true,
      },
      AgentDelegation: {
        Enabled: true,
      },
      ToolExecution: {
        Mode: "Local",
        TimeoutSeconds: 30,
      },
      AgentLoop: {
        MaxSteps: -1,
        MaxRepairAttempts: 2,
      },
      ActionPlanner: {
        Client: {
          Provider: "desktop/updated-model",
        },
        PlanningClient: {
          Provider: "openai-generic",
        },
      },
    },
    Cli: {
      Enabled: true,
    },
    AgentDelegation: {
      Enabled: true,
    },
    ToolExecution: {
      Mode: "Process",
      TimeoutSeconds: 30,
    },
    ActionPlanner: {
      MaxRepairAttempts: 7,
      Client: {
        Provider: "desktop/updated-model",
      },
      FinalAnswerClient: {
        Provider: "openai-generic",
      },
    },
    AgentLoop: {
      MaxSteps: -1,
      MaxRepairAttempts: 4,
      LoadedTools: "dynamic",
    },
  } as unknown as AgentSystemConfig;
  const legacyRevision = service.replaceConfig({
    commandId: "replace-desktop-config-2",
    baseRevision: service.snapshot().revision,
    config: service.snapshot().value,
    source: "ui_update",
  });
  assert.equal(legacyRevision.revision, 3);
  const legacyRepository = new AgentConfigSqliteRepository(desktopDatabasePath);
  legacyRepository.appendRevision({
    config: legacyConfig,
    source: "migration",
  });
  legacyRepository.close();
  service.close();
  service = undefined;

  reloaded = new AgentConfigService({
    workspaceRoot: desktopWorkspaceRoot,
    source: {
      kind: "sqlite",
      databasePath: desktopDatabasePath,
      seedConfig: desktopSeedConfig,
    },
  });
  const migratedSnapshot = reloaded.snapshot();
  assert.equal(migratedSnapshot.revision, 5);
  assert.equal(migratedSnapshot.value.ConfigVersion, CurrentAgentConfigVersion);
  assert.equal(migratedSnapshot.value.ToolExecution?.TimeoutSeconds, 30);
  assert.equal(migratedSnapshot.value.ActionPlanner?.MaxRepairAttempts, 7);
  assert.equal("Mode" in (migratedSnapshot.value.ToolExecution ?? {}), false);
  assert.equal("LoadedTools" in (migratedSnapshot.value.AgentLoop ?? {}), false);
  assert.equal("MaxSteps" in (migratedSnapshot.value.AgentLoop ?? {}), false);
  assert.equal("MaxRepairAttempts" in (migratedSnapshot.value.AgentLoop ?? {}), false);
  assert.equal("Cli" in (migratedSnapshot.value.Defaults ?? {}), false);
  assert.equal("AgentDelegation" in (migratedSnapshot.value.Defaults ?? {}), false);
  assert.equal(migratedSnapshot.value.Defaults?.ActionPlanner?.MaxRepairAttempts, 2);
  assert.equal("Mode" in (migratedSnapshot.value.Defaults?.ToolExecution ?? {}), false);
  assert.equal("MaxRepairAttempts" in (migratedSnapshot.value.Defaults?.AgentLoop ?? {}), false);
  assert.equal(migratedSnapshot.value.Defaults?.ActionPlanner?.Client?.ModelProviderId, "desktop/updated-model");
  assert.equal("Provider" in (migratedSnapshot.value.Defaults?.ActionPlanner?.PlanningClient ?? {}), false);
  assert.equal("Cli" in migratedSnapshot.value, false);
  assert.equal("AgentDelegation" in migratedSnapshot.value, false);
  assert.equal(migratedSnapshot.value.ActionPlanner?.Client?.ModelProviderId, "desktop/updated-model");
  assert.equal("Provider" in (migratedSnapshot.value.ActionPlanner?.FinalAnswerClient ?? {}), false);
  assert.equal(migratedSnapshot.value.ModelProviders[0].Id, "desktop/updated-model");
  assert.equal(migratedSnapshot.value.ModelProviderEndpoints?.[0]?.BaseUrl, "https://desktop.example.invalid/v1");
  assert.equal(migratedSnapshot.diagnostics.length, 1);
  assert.equal(migratedSnapshot.diagnostics[0].severity, "warning");
  reloaded.close();
  reloaded = undefined;
  const migratedRepository = new AgentConfigSqliteRepository(desktopDatabasePath);
  assert.equal(migratedRepository.latestRevision()?.source, "migration");
  const invalidRevision = migratedRepository.appendRevision({
    config: {
      ...migratedSnapshot.value,
      ConfigVersion: CurrentAgentConfigVersion,
      UnexpectedLegacyKey: true,
    } as unknown as AgentSystemConfig,
    source: "migration",
  });
  migratedRepository.close();

  assert.throws(
    () =>
      new AgentConfigService({
        workspaceRoot: desktopWorkspaceRoot,
        source: {
          kind: "sqlite",
          databasePath: desktopDatabasePath,
          seedConfig: desktopSeedConfig,
        },
      }),
    /配置数据库中的配置结构无效/,
  );
  const preservedInvalidRepository = new AgentConfigSqliteRepository(desktopDatabasePath);
  assert.equal(preservedInvalidRepository.latestRevision()?.revision, invalidRevision.revision);
  preservedInvalidRepository.close();

  console.log("Config service SQLite source verification passed.");
} finally {
  service?.close();
  reloaded?.close();
  await removeTemporaryWorkspace(workspaceRoot);
  await removeTemporaryWorkspace(desktopWorkspaceRoot);
}
