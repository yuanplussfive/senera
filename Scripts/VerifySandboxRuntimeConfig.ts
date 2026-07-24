import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveAgentDefaults, resolveSandboxRuntimeConfig } from "../Source/AgentSystem/AgentDefaults.js";
import {
  normalizeSandboxImages,
  resolveAgentSandboxRuntimePaths,
} from "../Source/AgentSystem/Sandbox/AgentSandboxRuntimePreparation.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";
import { SeneraMicrosandboxDefaults } from "../Source/AgentSystem/Execution/SeneraMicrosandboxDefaults.js";

const defaults = resolveAgentDefaults(undefined).SandboxRuntime;
assert.equal(defaults.Enabled, true);
assert.equal(defaults.BaseDir, ".senera/sandbox-runtime");
assert.deepEqual(defaults.Images, [SeneraMicrosandboxDefaults.image]);

const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-sandbox-runtime-config-"));

const config = {
  SandboxRuntime: {
    Enabled: false,
    BaseDir: ".sandbox/runtime",
    Images: ["node:22-bookworm-slim", "alpine"],
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
} satisfies AgentSystemConfig;

const resolved = resolveSandboxRuntimeConfig(config);
assert.equal(resolved.Enabled, false);
assert.deepEqual(resolved.Images, ["alpine", "node:22-bookworm-slim"]);

const paths = resolveAgentSandboxRuntimePaths(workspaceRoot, resolved);
assert.equal(path.relative(workspaceRoot, paths.baseDir), path.normalize(".sandbox/runtime"));
assert.deepEqual(Object.keys(paths), ["baseDir"]);

assert.deepEqual(normalizeSandboxImages(["alpine", "node:22-bookworm-slim"], ["alpine", "python"]), [
  "alpine",
  "node:22-bookworm-slim",
  "python",
]);

fs.rmSync(workspaceRoot, { recursive: true, force: true });

console.log("Sandbox runtime config verification passed.");
