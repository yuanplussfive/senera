import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AgentConfigService } from "../Source/AgentSystem/Config/AgentConfigService.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";

const tempRoot = path.join(process.cwd(), ".senera", "tmp", "verify-config-service");
fs.mkdirSync(tempRoot, { recursive: true });
const workspaceRoot = fs.mkdtempSync(path.join(tempRoot, "run-"));
const configPath = path.join(workspaceRoot, "senera.config.json");

let service: AgentConfigService | undefined;
let reloaded: AgentConfigService | undefined;

try {
  const initialConfig: AgentSystemConfig = {
    ConfigStore: {
      Enabled: true,
      DatabasePath: ".senera/Config.sqlite",
      MirrorJson: true,
    },
    ModelProviderEndpoints: [{
      Id: "default",
      BaseUrl: "https://example.invalid/v1",
      ApiKey: "test",
    }],
    ModelProviders: [{
      Id: "default",
      ProviderId: "default",
      Endpoint: "Responses",
      Model: "initial-model",
    }],
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
  assert.equal(first.value.ModelProviders[0].Model, "initial-model");
  assert.ok(first.databasePath?.endsWith(path.join(".senera", "Config.sqlite")));

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
    ModelProviders: [{
      ...first.value.ModelProviders[0],
      Model: "updated-model",
    }, {
      Id: "secondary/secondary-model",
      ProviderId: "secondary",
      Endpoint: "ChatCompletions",
      Model: "secondary-model",
    }],
  };

  const second = service.update({
    config: updatedConfig,
    source: "ui_update",
    mirrorJson: true,
  });
  assert.equal(second.source, "sqlite");
  assert.equal(second.revision, 2);
  assert.equal(second.value.ModelProviderEndpoints?.at(-1)?.Id, "secondary");
  assert.equal(second.value.ModelProviders[0].Model, "updated-model");

  const mirrored = JSON.parse(fs.readFileSync(configPath, "utf8")) as AgentSystemConfig;
  assert.equal(mirrored.ModelProviderEndpoints?.at(-1)?.Id, "secondary");
  assert.equal(mirrored.ModelProviders[0].Model, "updated-model");
  assert.equal(mirrored.ModelProviders[1].ProviderId, "secondary");

  const movedConfig: AgentSystemConfig = {
    ...second.value,
    ConfigStore: {
      Enabled: true,
      DatabasePath: ".senera/ConfigMoved.sqlite",
      MirrorJson: true,
    },
    ModelProviders: second.value.ModelProviders.map((provider, index) =>
      index === 0
        ? {
            ...provider,
            Model: "moved-model",
          }
        : provider
    ),
  };
  const moved = service.update({
    config: movedConfig,
    source: "ui_update",
  });
  assert.equal(moved.source, "sqlite");
  assert.equal(moved.revision, 1);
  assert.equal(moved.value.ModelProviders[0].Model, "moved-model");
  assert.equal(moved.value.ModelProviderEndpoints?.at(-1)?.Id, "secondary");
  assert.ok(moved.databasePath?.endsWith(path.join(".senera", "ConfigMoved.sqlite")));

  const movedMirror = JSON.parse(fs.readFileSync(configPath, "utf8")) as AgentSystemConfig;
  assert.equal(movedMirror.ConfigStore?.DatabasePath, ".senera/ConfigMoved.sqlite");
  assert.equal(movedMirror.ModelProviders[0].Model, "moved-model");
  assert.equal(movedMirror.ModelProviderEndpoints?.at(-1)?.Id, "secondary");

  service.close();
  service = undefined;

  reloaded = new AgentConfigService({
    workspaceRoot,
    source: {
      kind: "json",
      configPath,
    },
  });
  assert.equal(reloaded.snapshot().revision, 1);
  assert.equal(reloaded.snapshot().value.ModelProviders[0].Model, "moved-model");
  assert.ok(reloaded.snapshot().databasePath?.endsWith(path.join(".senera", "ConfigMoved.sqlite")));
  reloaded.close();
  reloaded = undefined;

  const desktopDatabasePath = path.join(workspaceRoot, ".senera", "DesktopConfig.sqlite");
  const desktopSeedConfig: AgentSystemConfig = {
    ModelProviderEndpoints: [{
      Id: "desktop",
      BaseUrl: "https://desktop.example.invalid/v1",
      ApiKey: "desktop-key",
    }],
    ModelProviders: [{
      Id: "desktop/seed-model",
      ProviderId: "desktop",
      Endpoint: "ChatCompletions",
      Model: "seed-model",
    }],
  };

  service = new AgentConfigService({
    workspaceRoot,
    source: {
      kind: "sqlite",
      databasePath: desktopDatabasePath,
      seedConfig: desktopSeedConfig,
    },
  });
  assert.equal(service.snapshot().source, "sqlite");
  assert.equal(service.snapshot().revision, 1);
  assert.equal(service.snapshot().value.ModelProviders[0].Model, "seed-model");

  const desktopUpdated = service.update({
    config: {
      ...service.snapshot().value,
      DefaultModelProviderId: "desktop/updated-model",
      ModelProviders: [{
        ...service.snapshot().value.ModelProviders[0],
        Id: "desktop/updated-model",
        Model: "updated-desktop-model",
      }],
    },
    source: "ui_update",
    mirrorJson: true,
  });
  assert.equal(desktopUpdated.revision, 2);
  assert.equal(desktopUpdated.value.ModelProviders[0].Model, "updated-desktop-model");
  service.close();
  service = undefined;

  reloaded = new AgentConfigService({
    workspaceRoot,
    source: {
      kind: "sqlite",
      databasePath: desktopDatabasePath,
      seedConfig: {
        ...desktopSeedConfig,
        ModelProviders: [{
          ...desktopSeedConfig.ModelProviders[0],
          Model: "ignored-seed-on-reload",
        }],
      },
    },
  });
  assert.equal(reloaded.snapshot().revision, 2);
  assert.equal(reloaded.snapshot().value.ModelProviders[0].Model, "updated-desktop-model");
  reloaded.close();
  reloaded = undefined;

  console.log("Config service SQLite source verification passed.");
} finally {
  service?.close();
  reloaded?.close();
  removeTempWorkspace(workspaceRoot);
}

function removeTempWorkspace(targetPath: string): void {
  const attempts = 10;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!isBusyFileError(error) || attempt === attempts) {
        throw error;
      }
      sleep(100 * attempt);
    }
  }

  try {
    fs.renameSync(targetPath, `${targetPath}.pending-delete-${Date.now()}`);
  } catch (error) {
    if (!isBusyFileError(error)) {
      throw error;
    }
  }
}

function isBusyFileError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && (error.code === "EBUSY" || error.code === "EPERM");
}

function sleep(milliseconds: number): void {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, milliseconds);
}
