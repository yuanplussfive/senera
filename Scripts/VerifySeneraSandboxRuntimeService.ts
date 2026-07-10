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
  assert.equal(snapshot.effectiveMode, "fallback");
  assert.equal(snapshot.updatedAt, "2026-01-02T03:04:05.000Z");
  assert.equal(snapshot.diagnostics[0]?.code, "microsandbox_backend_configured");
  assert.match(snapshot.message, /microsandbox 沙箱后端已配置/);

  service.markPreparing();
  const preparingSnapshot = service.snapshot();
  assert.equal(preparingSnapshot.state, "preparing");
  assert.equal(preparingSnapshot.effectiveMode, "fallback");
  assert.equal(preparingSnapshot.diagnostics[0]?.code, "microsandbox_runtime_preparing");

  service.markReady();
  const readySnapshot = service.snapshot();
  assert.equal(readySnapshot.state, "ready");
  assert.equal(readySnapshot.effectiveMode, "sandbox");
  assert.equal(readySnapshot.diagnostics[0]?.code, "microsandbox_runtime_ready");

  service.markFallback(new Error("WHP unavailable"));
  const runtimeFallbackSnapshot = service.snapshot();
  assert.equal(runtimeFallbackSnapshot.state, "fallback");
  assert.equal(runtimeFallbackSnapshot.effectiveMode, "fallback");
  assert.deepEqual(runtimeFallbackSnapshot.dependencies.errors, ["WHP unavailable"]);
  assert.equal(runtimeFallbackSnapshot.diagnostics[0]?.code, "microsandbox_runtime_fallback");

  const fallbackSnapshot = new AgentSandboxRuntimeService({
    platform: "linux",
    clock: () => new Date("2026-01-02T03:04:05.000Z"),
    packageAvailable: () => false,
  }).snapshot();
  assert.equal(fallbackSnapshot.provider, "microsandbox");
  assert.equal(fallbackSnapshot.supported, false);
  assert.equal(fallbackSnapshot.state, "fallback");
  assert.equal(fallbackSnapshot.effectiveMode, "fallback");
  assert.equal(fallbackSnapshot.diagnostics[0]?.code, "microsandbox_package_missing");

  console.log("Senera sandbox runtime service verification passed.");
}

await main();
