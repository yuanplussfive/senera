import assert from "node:assert/strict";
import { AgentSandboxRuntimeService } from "../Source/AgentSystem/Sandbox/AgentSandboxRuntimeService.js";
import { AgentSandboxRuntimeProviders } from "../Source/AgentSystem/Sandbox/AgentSandboxRuntimeTypes.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";

const clock = () => new Date("2026-01-02T03:04:05.000Z");
const windows = new AgentSandboxRuntimeService({
  platform: "win32",
  availability: { kind: "available", provider: AgentSandboxRuntimeProviders.DockerEngine },
  clock,
}).snapshot();
assert.equal(windows.platform, "win32");
assert.equal(windows.provider, undefined);
assert.equal(windows.supported, false);
assert.equal(windows.state, "disabled");
assert.equal(windows.effectiveMode, "host");
assert.equal(windows.effectiveTarget, "Local");
assert.equal(windows.shellDialect, "powershell");
assert.deepEqual(windows.availableExecutionTargets, ["Local"]);
assert.equal(windows.diagnostics[0]?.code, "host_execution_platform_policy");

const service = new AgentSandboxRuntimeService({
  platform: "linux",
  availability: { kind: "available", provider: AgentSandboxRuntimeProviders.DockerEngine },
  clock,
});

const snapshot = service.snapshot();
assert.equal(snapshot.platform, "linux");
assert.equal(snapshot.provider, "docker-engine");
assert.equal(snapshot.supported, true);
assert.equal(snapshot.state, "unknown");
assert.equal(snapshot.effectiveMode, "unavailable");
assert.equal(snapshot.updatedAt, clock().toISOString());
assert.equal(snapshot.diagnostics[0]?.code, "docker-engine_backend_configured");

service.markPreparing();
assert.deepEqual(
  { state: service.snapshot().state, code: service.snapshot().diagnostics[0]?.code },
  { state: "preparing", code: "docker-engine_runtime_preparing" },
);

service.markReady();
assert.deepEqual(
  {
    state: service.snapshot().state,
    mode: service.snapshot().effectiveMode,
    code: service.snapshot().diagnostics[0]?.code,
  },
  { state: "ready", mode: "sandbox", code: "docker-engine_runtime_ready" },
);

service.markUnavailable(new Error("Docker Desktop unavailable"));
const unavailable = service.snapshot();
assert.equal(unavailable.state, "unavailable");
assert.deepEqual(unavailable.dependencies.errors, ["Docker Desktop unavailable"]);
assert.equal(unavailable.diagnostics[0]?.code, "docker-engine_runtime_unavailable");

const disabled = new AgentSandboxRuntimeService({
  platform: "linux",
  availability: { kind: "disabled", reason: "configuration-disabled" },
  configSnapshot: () =>
    ({
      ModelProviderEndpoints: [],
      ModelProviders: [],
      SandboxRuntime: { Enabled: false },
    }) satisfies AgentSystemConfig,
}).snapshot();
assert.equal(disabled.provider, undefined);
assert.equal(disabled.state, "disabled");
assert.equal(disabled.effectiveMode, "host");
assert.equal(disabled.effectiveTarget, "Local");
assert.deepEqual(disabled.availableExecutionTargets, ["Local"]);
assert.equal(disabled.diagnostics[0]?.code, "docker_disabled_by_runtime_configuration");

console.log("Senera sandbox runtime service verification passed.");
