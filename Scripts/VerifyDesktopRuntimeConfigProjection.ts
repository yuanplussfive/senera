import assert from "node:assert/strict";
import path from "node:path";
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

const projected = projectDesktopRuntimeConfig(sourceConfig, "C:/Users/test/workspace");

assert.deepEqual(projected.SandboxRuntime, {
  Provider: "auto",
  BaseDir: path.join("C:/Users/test/workspace", ".senera", "desktop"),
});
assert.equal(projected.ModelProviders[0].Model, "model-a");

const explicitDocker = projectDesktopRuntimeConfig(
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
  "C:/Users/test/workspace",
);
assert.deepEqual(explicitDocker.SandboxRuntime, {
  Provider: "auto",
  BaseDir: path.join("C:/Users/test/workspace", ".senera", "desktop"),
  Docker: {
    EngineEndpoint: "npipe:////./pipe/docker_engine",
    Image: "registry.example/runtime:verified",
    PullPolicy: "never",
  },
});

console.log("Desktop runtime config projection verification passed.");
