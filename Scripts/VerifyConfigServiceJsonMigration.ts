import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AgentConfigService } from "../Source/AgentSystem/Config/AgentConfigService.js";
import { AgentConfigMigrationError } from "../Source/AgentSystem/Config/AgentConfigMigration.js";
import { CurrentAgentConfigVersion } from "../Source/AgentSystem/Config/AgentConfigVersion.js";
import { AgentJsonFileError } from "../Source/AgentSystem/Config/AgentJsonFileLoader.js";
import { AgentConfigSqliteRepository } from "../Source/AgentSystem/Config/AgentConfigSqliteRepository.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";

const tempRoot = path.join(process.cwd(), ".senera", "tmp", "verify-config-json-migration");
fs.mkdirSync(tempRoot, { recursive: true });
const workspaceRoot = fs.mkdtempSync(path.join(tempRoot, "run-"));

try {
  verifyLegacyJsonMigration();
  verifyUnknownFieldsRemainErrors();
  verifyFutureVersionsRemainErrors();
  verifyInvalidStoredRevisionFailsWithoutJsonFallback();
  console.log("Config service JSON migration verification passed.");
} finally {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
}

function verifyLegacyJsonMigration(): void {
  const configPath = path.join(workspaceRoot, "legacy.json");
  const legacy = createLegacyConfig();
  const originalText = `${JSON.stringify(legacy, null, 2)}\n`;
  fs.writeFileSync(configPath, originalText, "utf8");

  const service = new AgentConfigService({
    workspaceRoot,
    source: {
      kind: "json",
      configPath,
    },
  });
  const snapshot = service.snapshot();
  service.close();

  assert.equal(snapshot.source, "sqlite");
  assert.equal(snapshot.revision, 1);
  assert.equal(snapshot.value.ConfigVersion, CurrentAgentConfigVersion);
  assert.equal(snapshot.value.ActionPlanner?.MaxRepairAttempts, 7);
  assert.equal(snapshot.value.Defaults?.ActionPlanner?.MaxRepairAttempts, 2);
  assert.equal(snapshot.value.ActionPlanner?.Client?.ModelProviderId, "legacy-model");
  assert.equal(snapshot.value.Defaults?.ActionPlanner?.Client?.ModelProviderId, "legacy-model");
  assert.equal("Provider" in (snapshot.value.ActionPlanner?.FinalAnswerClient ?? {}), false);
  assert.equal("Provider" in (snapshot.value.Defaults?.ActionPlanner?.PlanningClient ?? {}), false);
  assert.equal("Cli" in snapshot.value, false);
  assert.equal("AgentDelegation" in snapshot.value, false);
  assert.equal("Cli" in (snapshot.value.Defaults ?? {}), false);
  assert.equal("AgentDelegation" in (snapshot.value.Defaults ?? {}), false);
  assert.equal("Mode" in (snapshot.value.ToolExecution ?? {}), false);
  assert.equal("Mode" in (snapshot.value.Defaults?.ToolExecution ?? {}), false);
  assert.equal("MaxSteps" in (snapshot.value.AgentLoop ?? {}), false);
  assert.equal("MaxRepairAttempts" in (snapshot.value.AgentLoop ?? {}), false);
  assert.equal("LoadedTools" in (snapshot.value.AgentLoop ?? {}), false);
  assert.equal("DecisionActionDescription" in (snapshot.value.PluginDocumentation ?? {}), false);
  assert.equal(fs.readFileSync(`${configPath}.v0.bak`, "utf8"), originalText);

  const persisted = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
  assert.equal(persisted.ConfigVersion, CurrentAgentConfigVersion);
  assert.equal("Cli" in persisted, false);
  assert.equal((persisted.Defaults as Record<string, unknown>).Cli, undefined);
  assert.equal(snapshot.diagnostics.length, 1);

  const reloaded = new AgentConfigService({
    workspaceRoot,
    source: {
      kind: "json",
      configPath,
    },
  });
  assert.deepEqual(reloaded.snapshot().diagnostics, []);
  reloaded.close();
  assert.equal(fs.readFileSync(`${configPath}.v0.bak`, "utf8"), originalText);
}

function verifyUnknownFieldsRemainErrors(): void {
  const configPath = path.join(workspaceRoot, "unknown.json");
  const legacy = createLegacyConfig();
  const defaults = legacy.Defaults as Record<string, unknown>;
  const agentLoop = defaults.AgentLoop as Record<string, unknown>;
  agentLoop.LoadedToolz = "dynamic";
  const originalText = `${JSON.stringify(legacy, null, 2)}\n`;
  fs.writeFileSync(configPath, originalText, "utf8");

  assert.throws(
    () =>
      new AgentConfigService({
        workspaceRoot,
        source: {
          kind: "json",
          configPath,
        },
      }),
    (error: unknown) => error instanceof AgentJsonFileError && error.diagnostic.message.includes("LoadedToolz"),
  );
  assert.equal(fs.readFileSync(configPath, "utf8"), originalText);
  assert.equal(fs.existsSync(`${configPath}.v0.bak`), false);
}

function verifyFutureVersionsRemainErrors(): void {
  const configPath = path.join(workspaceRoot, "future.json");
  const future = createLegacyConfig();
  future.ConfigVersion = CurrentAgentConfigVersion + 1;
  fs.writeFileSync(configPath, `${JSON.stringify(future, null, 2)}\n`, "utf8");

  assert.throws(
    () =>
      new AgentConfigService({
        workspaceRoot,
        source: {
          kind: "json",
          configPath,
        },
      }),
    (error: unknown) => error instanceof AgentConfigMigrationError,
  );
  assert.equal(fs.existsSync(`${configPath}.v${CurrentAgentConfigVersion + 1}.bak`), false);
}

function verifyInvalidStoredRevisionFailsWithoutJsonFallback(): void {
  const configPath = path.join(workspaceRoot, "invalid-store.json");
  const currentConfig = createCurrentConfig();
  const originalText = `${JSON.stringify(currentConfig, null, 2)}\n`;
  fs.writeFileSync(configPath, originalText, "utf8");

  const repository = new AgentConfigSqliteRepository(path.join(workspaceRoot, ".senera", "Config.sqlite"));
  repository.appendRevision({
    config: {
      ...currentConfig,
      UnexpectedStoredKey: true,
    } as unknown as AgentSystemConfig,
    source: "migration",
  });
  repository.close();

  assert.throws(
    () =>
      new AgentConfigService({
        workspaceRoot,
        source: {
          kind: "json",
          configPath,
        },
      }),
    /配置数据库中的配置结构无效/,
  );
  assert.equal(fs.readFileSync(configPath, "utf8"), originalText);
}

function createCurrentConfig(): Record<string, unknown> {
  return {
    ConfigVersion: CurrentAgentConfigVersion,
    ModelProviderEndpoints: [
      {
        Id: "current-endpoint",
        BaseUrl: "https://current.example.invalid/v1",
        ApiKey: "test",
      },
    ],
    ModelProviders: [
      {
        Id: "current-model",
        ProviderId: "current-endpoint",
        Endpoint: "ChatCompletions",
        Model: "current-model",
      },
    ],
  };
}

function createLegacyConfig(): Record<string, unknown> {
  return {
    Cli: { Enabled: true },
    AgentDelegation: { Enabled: true },
    Defaults: {
      Cli: { Enabled: true },
      AgentDelegation: { Enabled: true },
      ToolExecution: { Mode: "Process", TimeoutSeconds: 30 },
      AgentLoop: { MaxSteps: 16, MaxRepairAttempts: 2 },
      ActionPlanner: {
        Client: { Provider: "legacy-model" },
        PlanningClient: { Provider: "openai-generic" },
      },
    },
    ToolExecution: { Mode: "Process", TimeoutSeconds: 30 },
    AgentLoop: { MaxSteps: 16, MaxRepairAttempts: 4, LoadedTools: "all" },
    ActionPlanner: {
      MaxRepairAttempts: 7,
      Client: { Provider: "legacy-model" },
      FinalAnswerClient: { Provider: "openai-generic" },
    },
    PluginDocumentation: {
      ToolDescription: {
        MinNonEmptyLines: 1,
        SummarySection: "Summary",
        TriggerSection: "Trigger",
        AvoidSection: "Avoid",
        RequiredSections: ["Summary"],
      },
      DecisionActionDescription: "Deprecated legacy description",
    },
    ModelProviderEndpoints: [
      {
        Id: "legacy-endpoint",
        BaseUrl: "https://legacy.example.invalid/v1",
        ApiKey: "test",
      },
    ],
    ModelProviders: [
      {
        Id: "legacy-model",
        ProviderId: "legacy-endpoint",
        Endpoint: "ChatCompletions",
        Model: "legacy-model",
      },
    ],
  };
}
