import assert from "node:assert/strict";
import path from "node:path";
import {
  resolveAgentDefaults,
  resolveSandboxRuntimeConfig,
} from "../Source/AgentSystem/AgentDefaults.js";
import {
  normalizeSandboxImages,
  resolveAgentSandboxRuntimePaths,
} from "../Source/AgentSystem/Sandbox/AgentSandboxRuntimePreparation.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";

const defaults = resolveAgentDefaults(undefined).SandboxRuntime;
assert.equal(defaults.BaseDir, ".senera/sandbox-runtime");
assert.equal(defaults.BundleDir, ".senera/sandbox-bundles");
assert.deepEqual(defaults.Images, ["alpine"]);

const config = {
  SandboxRuntime: {
    BaseDir: ".sandbox/runtime",
    BundleDir: ".sandbox/bundles",
    Images: ["node:22-bookworm-slim", "alpine"],
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
    Model: "model-a",
  }],
} satisfies AgentSystemConfig;

const resolved = resolveSandboxRuntimeConfig(config);
assert.deepEqual(resolved.Images, ["alpine", "node:22-bookworm-slim"]);

const workspaceRoot = path.resolve("sandbox-runtime-config-fixture");
const paths = resolveAgentSandboxRuntimePaths(workspaceRoot, resolved);
assert.equal(path.relative(workspaceRoot, paths.baseDir), path.normalize(".sandbox/runtime"));
assert.equal(path.relative(workspaceRoot, paths.bundleDir), path.normalize(".sandbox/bundles"));
assert.ok(paths.msbPath.endsWith(process.platform === "win32" ? "msb.exe" : "msb"));
assert.ok(paths.libkrunfwPath.includes("libkrunfw"));

assert.deepEqual(
  normalizeSandboxImages(["alpine", "node:22-bookworm-slim"], ["alpine", "python"]),
  ["alpine", "node:22-bookworm-slim", "python"],
);

console.log("Sandbox runtime config verification passed.");
