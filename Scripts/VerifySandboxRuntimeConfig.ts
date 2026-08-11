import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveAgentDefaults, resolveSandboxRuntimeConfig } from "../Source/AgentSystem/AgentDefaults.js";
import { resolveAgentSandboxRuntimePaths } from "../Source/AgentSystem/Sandbox/AgentSandboxRuntimePreparation.js";
import {
  readAgentSandboxDistributionContract,
  resolveAgentSandboxDistributionTarget,
} from "../Source/AgentSystem/Sandbox/AgentSandboxDistributionContract.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";

const distribution = readAgentSandboxDistributionContract();
const target = resolveAgentSandboxDistributionTarget(distribution);
const defaults = resolveAgentDefaults(undefined).SandboxRuntime;
assert.equal(defaults.Enabled, true);
assert.equal(defaults.Provider, "auto");
assert.equal(defaults.BaseDir, ".senera/sandbox-runtime");
assert.equal(defaults.Docker.Image, target.registryImage);
assert.equal(defaults.Docker.PullPolicy, "if-missing");
assert.ok(defaults.Docker.DetectionTimeoutSeconds > 0);
assert.ok(defaults.Docker.PreparationTimeoutSeconds > 0);

const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "senera-sandbox-runtime-config-"));
try {
  const config = {
    SandboxRuntime: {
      Enabled: false,
      Provider: "gvisor",
      BaseDir: ".sandbox/runtime",
      Docker: {
        EngineEndpoint: "npipe:////./pipe/docker_engine",
        WorkerEndpoint: "worker.sock",
        DetectionTimeoutSeconds: 7,
        Image: "registry.example/runtime:verified",
        PullPolicy: "never",
        PreparationTimeoutSeconds: 45,
      },
    },
    ModelProviderEndpoints: [],
    ModelProviders: [],
  } satisfies AgentSystemConfig;

  const resolved = resolveSandboxRuntimeConfig(config);
  assert.deepEqual(resolved, {
    Enabled: false,
    Provider: "gvisor",
    BaseDir: ".sandbox/runtime",
    Docker: {
      EngineEndpoint: "npipe:////./pipe/docker_engine",
      WorkerEndpoint: "worker.sock",
      DetectionTimeoutSeconds: 7,
      Image: "registry.example/runtime:verified",
      PullPolicy: "never",
      PreparationTimeoutSeconds: 45,
    },
  });

  const paths = resolveAgentSandboxRuntimePaths(workspaceRoot, resolved);
  assert.equal(path.relative(workspaceRoot, paths.baseDir), path.normalize(".sandbox/runtime"));
  assert.deepEqual(Object.keys(paths), ["baseDir"]);
} finally {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
}

console.log("Sandbox runtime config verification passed.");
