import assert from "node:assert/strict";
import { projectDesktopRuntimeConfig } from "../Apps/Desktop/DesktopRuntimeConfig.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";

const sourceConfig: AgentSystemConfig = {
  PluginRoots: {
    System: ["./System/Plugins"],
    User: ["./Plugins"],
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
      Model: "model-a",
    },
  ],
};

const projected = projectDesktopRuntimeConfig(
  {
    systemPluginRoot: "C:/Users/test/AppData/Roaming/Senera/runtime/System/Plugins",
    userPluginRoot: "C:/Users/test/AppData/Roaming/Senera/runtime/Plugins",
    sandboxRuntimeRoot: "C:/Users/test/AppData/Roaming/Senera/runtime/SandboxRuntime",
    sandboxBundleRoot: "C:/Users/test/AppData/Roaming/Senera/runtime/SandboxBundles",
  },
  sourceConfig,
);

assert.deepEqual(sourceConfig.PluginRoots, {
  System: ["./System/Plugins"],
  User: ["./Plugins"],
});
assert.deepEqual(projected.PluginRoots, {
  System: ["C:/Users/test/AppData/Roaming/Senera/runtime/System/Plugins"],
  User: ["C:/Users/test/AppData/Roaming/Senera/runtime/Plugins"],
});
assert.deepEqual(projected.SandboxRuntime, {
  BaseDir: "C:/Users/test/AppData/Roaming/Senera/runtime/SandboxRuntime",
  BundleDir: "C:/Users/test/AppData/Roaming/Senera/runtime/SandboxBundles",
});
assert.equal(projected.ModelProviders[0].Model, "model-a");

console.log("Desktop runtime config projection verification passed.");
