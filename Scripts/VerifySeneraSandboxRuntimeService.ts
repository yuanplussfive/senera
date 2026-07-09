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
  assert.equal(snapshot.effectiveMode, "sandbox");
  assert.equal(snapshot.updatedAt, "2026-01-02T03:04:05.000Z");
  assert.equal(snapshot.diagnostics[0]?.code, "microsandbox_backend_configured");
  assert.match(snapshot.message, /microsandbox 沙箱后端已配置/);

  const fallbackSnapshot = new AgentSandboxRuntimeService({
    platform: "linux",
    clock: () => new Date("2026-01-02T03:04:05.000Z"),
    packageAvailable: () => false,
  }).snapshot();
  assert.equal(fallbackSnapshot.provider, "microsandbox");
  assert.equal(fallbackSnapshot.supported, false);
  assert.equal(fallbackSnapshot.effectiveMode, "fallback");
  assert.equal(fallbackSnapshot.diagnostics[0]?.code, "microsandbox_package_missing");

  console.log("Senera sandbox runtime service verification passed.");
}

await main();
