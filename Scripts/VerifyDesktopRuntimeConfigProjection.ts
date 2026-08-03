import assert from "node:assert/strict";
import { projectDesktopRuntimeConfig } from "../Apps/Desktop/DesktopRuntimeConfig.js";
import { AgentSandboxRuntimeProviders } from "../Source/AgentSystem/Sandbox/AgentSandboxRuntimeTypes.js";
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
  { packaged: true },
);

assert.deepEqual(projected.SandboxRuntime, {
  Provider: AgentSandboxRuntimeProviders.Microsandbox,
  BaseDir: "C:/Users/test/AppData/Roaming/Senera/runtime/SandboxRuntime",
  Provisioning: { Kind: "ReleaseBundle" },
});
assert.equal(projected.ModelProviders[0].Model, "model-a");

const explicitOci = projectDesktopRuntimeConfig(
  {
    sandboxRuntimeRoot: "sandbox",
  },
  {
    ...sourceConfig,
    SandboxRuntime: { Provisioning: { Kind: "Oci", Images: ["registry.example/runtime@sha256:digest"] } },
  },
  { packaged: true },
);
assert.equal(explicitOci.SandboxRuntime?.Provider, AgentSandboxRuntimeProviders.Microsandbox);
assert.deepEqual(explicitOci.SandboxRuntime?.Provisioning, { Kind: "ReleaseBundle" });

console.log("Desktop runtime config projection verification passed.");
