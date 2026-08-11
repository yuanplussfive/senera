import assert from "node:assert/strict";
import { projectDesktopRuntimeConfig } from "../Apps/Desktop/DesktopRuntimeConfig.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";

const sourceConfig: AgentSystemConfig = {
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
      Model: "model-a",
    },
  ],
};

const projected = projectDesktopRuntimeConfig(
  {
    sandboxRuntimeRoot: "C:/Users/test/AppData/Roaming/Senera/runtime/SandboxRuntime",
  },
  sourceConfig,
);

assert.deepEqual(projected.SandboxRuntime, {
  Provider: "auto",
  BaseDir: "C:/Users/test/AppData/Roaming/Senera/runtime/SandboxRuntime",
});
assert.equal(projected.ModelProviders[0].Model, "model-a");

const explicitDocker = projectDesktopRuntimeConfig(
  {
    sandboxRuntimeRoot: "sandbox",
  },
  {
    ...sourceConfig,
    SandboxRuntime: {
      Provider: "docker-engine",
      Docker: {
        EngineEndpoint: "npipe:////./pipe/docker_engine",
        Image: "registry.example/runtime:verified",
        PullPolicy: "never",
      },
    },
  },
);
assert.deepEqual(explicitDocker.SandboxRuntime, {
  Provider: "auto",
  BaseDir: "sandbox",
  Docker: {
    EngineEndpoint: "npipe:////./pipe/docker_engine",
    Image: "registry.example/runtime:verified",
    PullPolicy: "never",
  },
});

console.log("Desktop runtime config projection verification passed.");
