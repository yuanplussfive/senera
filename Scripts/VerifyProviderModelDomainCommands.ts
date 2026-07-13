import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AgentConfigService } from "../Source/AgentSystem/Config/AgentConfigService.js";
import {
  AgentConfigStaleWriteError,
  AgentProviderModelConfigCommandError,
} from "../Source/AgentSystem/Config/AgentProviderModelConfigCommands.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";

const tempRoot = path.join(process.cwd(), ".senera", "tmp", "verify-provider-model-domain");
fs.mkdirSync(tempRoot, { recursive: true });
const workspaceRoot = fs.mkdtempSync(path.join(tempRoot, "run-"));

let service: AgentConfigService | undefined;

try {
  service = createService(baseConfig());
  assert.equal(service.snapshot().revision, 1);

  const staleRevision = service.snapshot().revision;
  const createdIdentity = service.upsertProviderEndpoint({
    expectedRevision: staleRevision,
    endpoint: {
      Id: "custom",
      Icon: "openai",
      Kind: "OpenAICompatible",
    },
  });
  assert.equal(createdIdentity.revision, 2);
  assert.deepEqual(findEndpoint(createdIdentity.value, "custom"), {
    Id: "custom",
    Icon: "openai",
    Kind: "OpenAICompatible",
  });

  const confirmedConnection = service.upsertProviderEndpoint({
    expectedRevision: service.snapshot().revision,
    endpoint: {
      ...findEndpoint(service.snapshot().value, "custom"),
      BaseUrl: "https://custom.example.test/v1",
      ApiKey: "custom-key",
    },
  });
  assert.equal(confirmedConnection.revision, 3);
  assert.equal(findEndpoint(confirmedConnection.value, "custom").BaseUrl, "https://custom.example.test/v1");
  assert.throws(
    () => service?.upsertProviderEndpoint({
      expectedRevision: staleRevision,
      endpoint: {
        Id: "stale",
        BaseUrl: "https://stale.example.test/v1",
      },
    }),
    AgentConfigStaleWriteError,
  );
  assert.equal(service.snapshot().value.ModelProviderEndpoints?.some((endpoint) => endpoint.Id === "stale"), false);

  const imported = service.bulkImportProviderModels({
    expectedRevision: service.snapshot().revision,
    models: [{
      Id: "custom/model-a",
      ProviderId: "custom",
      Endpoint: "ChatCompletions",
      Model: "remote-model-a",
      Temperature: 0.2,
    }],
    groupAssignments: [{
      modelId: "custom/model-a",
      groupId: "reasoning",
      label: "Reasoning",
      icon: "brain",
    }],
  });
  assert.equal(imported.value.ModelProviders.some((model) => model.Id === "custom/model-a"), true);
  assert.deepEqual(imported.value.ModelGroups?.find((group) => group.Id === "reasoning"), {
    Id: "reasoning",
    Label: "Reasoning",
    Icon: "brain",
    Strategies: [{
      Match: "exact",
      Values: ["custom/model-a"],
    }],
  });

  const preserved = service.upsertProviderModel({
    expectedRevision: service.snapshot().revision,
    model: {
      Id: "custom/model-a",
      ProviderId: "custom",
      Endpoint: "Responses",
      Model: "remote-model-a",
    },
  });
  const preservedModel = findModel(preserved.value, "custom/model-a");
  assert.equal(preservedModel.Endpoint, "Responses");
  assert.equal(preservedModel.Temperature, 0.2);

  const renamed = service.renameProviderEndpoint({
    expectedRevision: service.snapshot().revision,
    providerId: "custom",
    nextProviderId: "custom-renamed",
  });
  assert.equal(findEndpoint(renamed.value, "custom-renamed").BaseUrl, "https://custom.example.test/v1");
  assert.equal(findModel(renamed.value, "custom/model-a").ProviderId, "custom-renamed");
  assert.equal(renamed.value.DefaultModelProviderId, "main");
  assert.throws(
    () => service?.renameProviderEndpoint({
      expectedRevision: service?.snapshot().revision,
      providerId: "openai",
      nextProviderId: "openai-custom",
    }),
    /内置供应商端点不能重命名/,
  );

  assert.throws(
    () => service?.deleteProviderEndpoint({
      expectedRevision: service?.snapshot().revision,
      providerId: "custom-renamed",
    }),
    /cascadeModels=true/,
  );
  assert.equal(service.snapshot().value.ModelProviders.some((model) => model.ProviderId === "custom-renamed"), true);

  const defaultChanged = service.setDefaultProviderModel({
    expectedRevision: service.snapshot().revision,
    modelId: "custom/model-a",
  });
  assert.equal(defaultChanged.value.DefaultModelProviderId, "custom/model-a");
  assert.throws(
    () => service?.deleteProviderModel({
      expectedRevision: service?.snapshot().revision,
      modelId: "custom/model-a",
    }),
    /replacementDefaultModelId/,
  );
  assert.throws(
    () => service?.deleteProviderModel({
      expectedRevision: service?.snapshot().revision,
      modelId: "custom/model-a",
      replacementDefaultModelId: "missing",
    }),
    /DefaultModelProviderId=missing/,
  );

  const modelDeleted = service.deleteProviderModel({
    expectedRevision: service.snapshot().revision,
    modelId: "custom/model-a",
    replacementDefaultModelId: "main",
  });
  assert.equal(modelDeleted.value.DefaultModelProviderId, "main");
  assert.equal(modelDeleted.value.ModelProviders.some((model) => model.Id === "custom/model-a"), false);
  assert.equal(modelDeleted.value.ModelGroups?.find((group) => group.Id === "reasoning")?.Strategies?.length ?? 0, 0);

  const reimported = service.bulkImportProviderModels({
    expectedRevision: service.snapshot().revision,
    models: [{
      Id: "custom/model-b",
      ProviderId: "custom-renamed",
      Endpoint: "ChatCompletions",
      Model: "remote-model-b",
    }],
  });
  assert.equal(reimported.value.ModelProviders.some((model) => model.Id === "custom/model-b"), true);

  const endpointDeleted = service.deleteProviderEndpoint({
    expectedRevision: service.snapshot().revision,
    providerId: "custom-renamed",
    cascadeModels: true,
  });
  assert.equal(endpointDeleted.value.ModelProviderEndpoints?.some((endpoint) => endpoint.Id === "custom-renamed"), false);
  assert.equal(endpointDeleted.value.ModelProviders.some((model) => model.ProviderId === "custom-renamed"), false);
  assert.equal(endpointDeleted.value.DefaultModelProviderId, "main");

  assert.throws(
    () => service?.setDefaultProviderModel({
      expectedRevision: service?.snapshot().revision,
      modelId: "missing-model",
    }),
    /DefaultModelProviderId=missing-model/,
  );
  assert.throws(
    () => service?.upsertProviderModel({
      expectedRevision: service?.snapshot().revision,
      model: {
        Id: "missing-provider/model",
        ProviderId: "missing-provider",
        Endpoint: "ChatCompletions",
        Model: "missing-provider-model",
      },
    }),
    /ProviderId=missing-provider/,
  );

  assert.equal(service.snapshot().value.DefaultModelProviderId, "main");
  const finalRevision = service.snapshot().revision;
  assert.ok(finalRevision !== undefined && finalRevision > 1);

  console.log("Provider/model domain command verification passed.");
} finally {
  service?.close();
  removeTempWorkspace(workspaceRoot);
}

function createService(seedConfig: AgentSystemConfig): AgentConfigService {
  return new AgentConfigService({
    workspaceRoot,
    source: {
      kind: "sqlite",
      databasePath: path.join(workspaceRoot, ".senera", "Config.sqlite"),
      seedConfig,
    },
  });
}

function baseConfig(): AgentSystemConfig {
  return {
    ModelProviderEndpoints: [{
      Id: "main-provider",
      BaseUrl: "https://main.example.test/v1",
      ApiKey: "main-key",
    }],
    ModelProviders: [{
      Id: "main",
      ProviderId: "main-provider",
      Endpoint: "Responses",
      Model: "main-model",
    }, {
      Id: "backup",
      ProviderId: "main-provider",
      Endpoint: "ChatCompletions",
      Model: "backup-model",
    }],
    DefaultModelProviderId: "main",
  };
}

function findEndpoint(config: AgentSystemConfig, id: string) {
  const endpoint = config.ModelProviderEndpoints?.find((candidate) => candidate.Id === id);
  assert.ok(endpoint, `Missing endpoint: ${id}`);
  return endpoint;
}

function findModel(config: AgentSystemConfig, id: string) {
  const model = config.ModelProviders.find((candidate) => candidate.Id === id);
  assert.ok(model, `Missing model: ${id}`);
  return model;
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
