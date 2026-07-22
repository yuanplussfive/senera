import assert from "node:assert/strict";
import { AgentSandboxRuntimeService } from "../Source/AgentSystem/Sandbox/AgentSandboxRuntimeService.js";

async function main(): Promise<void> {
  const service = new AgentSandboxRuntimeService({
    platform: "win32",
    clock: () => new Date("2026-01-02T03:04:05.000Z"),
    packageAvailable: () => true,
  });

  const snapshot = service.snapshot();
  assert.equal(snapshot.platform, "win32");
  assert.equal(snapshot.provider, "microsandbox");
  assert.equal(snapshot.supported, true);
  assert.equal(snapshot.state, "unknown");
  assert.equal(snapshot.effectiveMode, "unavailable");
  assert.equal(snapshot.updatedAt, "2026-01-02T03:04:05.000Z");
  assert.equal(snapshot.diagnostics[0]?.code, "microsandbox_backend_configured");
  assert.match(snapshot.message, /microsandbox 沙箱后端已配置/);

  service.markPreparing();
  const preparingSnapshot = service.snapshot();
  assert.equal(preparingSnapshot.state, "preparing");
  assert.equal(preparingSnapshot.effectiveMode, "unavailable");
  assert.equal(preparingSnapshot.diagnostics[0]?.code, "microsandbox_runtime_preparing");

  service.markReady();
  const readySnapshot = service.snapshot();
  assert.equal(readySnapshot.state, "ready");
  assert.equal(readySnapshot.effectiveMode, "sandbox");
  assert.equal(readySnapshot.diagnostics[0]?.code, "microsandbox_runtime_ready");

  service.markUnavailable(new Error("WHP unavailable"));
  const runtimeUnavailableSnapshot = service.snapshot();
  assert.equal(runtimeUnavailableSnapshot.state, "unavailable");
  assert.equal(runtimeUnavailableSnapshot.effectiveMode, "unavailable");
  assert.deepEqual(runtimeUnavailableSnapshot.dependencies.errors, ["WHP unavailable"]);
  assert.equal(runtimeUnavailableSnapshot.diagnostics[0]?.code, "microsandbox_runtime_unavailable");

  const unavailableSnapshot = new AgentSandboxRuntimeService({
    platform: "linux",
    clock: () => new Date("2026-01-02T03:04:05.000Z"),
    packageAvailable: () => false,
  }).snapshot();
  assert.equal(unavailableSnapshot.provider, "microsandbox");
  assert.equal(unavailableSnapshot.supported, false);
  assert.equal(unavailableSnapshot.state, "unavailable");
  assert.equal(unavailableSnapshot.effectiveMode, "unavailable");
  assert.equal(unavailableSnapshot.diagnostics[0]?.code, "microsandbox_package_missing");

  console.log("Senera sandbox runtime service verification passed.");
}

await main();
