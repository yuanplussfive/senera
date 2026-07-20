import assert from "node:assert/strict";
import { resolveAgentDefaults } from "../Source/AgentSystem/AgentDefaults.js";
import { SeneraMicrosandboxBackend } from "../Source/AgentSystem/Execution/SeneraMicrosandboxBackend.js";
import { SeneraMicrosandboxDynamicSdkAdapter } from "../Source/AgentSystem/Execution/SeneraMicrosandboxSdkAdapter.js";
import { resolvePreparedSeneraTerminalSidecarGuestRuntime } from "../Source/AgentSystem/Execution/SeneraTerminalSidecarGuestRuntime.js";
import { SeneraTerminalCapabilityNames } from "../Source/AgentSystem/Execution/SeneraTerminalTypes.js";
import { resolveAgentSandboxRuntimePaths } from "../Source/AgentSystem/Sandbox/AgentSandboxRuntimePreparation.js";

const workspaceRoot = process.cwd();
const runtimeConfig = resolveAgentDefaults(undefined).SandboxRuntime;
const runtimePaths = resolveAgentSandboxRuntimePaths(workspaceRoot, runtimeConfig);
const terminalRuntime = resolvePreparedSeneraTerminalSidecarGuestRuntime(runtimePaths.baseDir);

const backend = new SeneraMicrosandboxBackend({
  workspaceRoot,
  runtimePaths,
  terminalRuntime,
  sdk: new SeneraMicrosandboxDynamicSdkAdapter(),
});

const processResult = await backend.executeProcess({
  command: "/bin/sh",
  args: ["-lc", "printf 'real-sandbox-ok\\n'; printf '%s\\n' \"$SENERA_SMOKE_ENV\""],
  cwd: workspaceRoot,
  env: { SENERA_SMOKE_ENV: "environment-ok" },
  timeoutMs: 30_000,
  limits: { timeoutMs: 30_000, maxStdoutBytes: 4_096, maxStderrBytes: 4_096 },
});
assert.equal(processResult.stdout, "real-sandbox-ok\nenvironment-ok\n");
assert.equal(processResult.stderr, "");
assert.equal(processResult.exitCode, 0);

const terminal = await backend.spawn("/bin/sh", ["-i"], {
  cwd: workspaceRoot,
  columns: 100,
  rows: 24,
  maxDurationMs: 30_000,
});
const chunks: string[] = [];
const exit = new Promise<{ exitCode: number; signal?: NodeJS.Signals | number }>((resolve) => terminal.onExit(resolve));
const data = terminal.onData((chunk) => chunks.push(Buffer.from(chunk).toString("utf8")));
try {
  await terminal.resize?.(132, 40);
  await terminal.write(`stty size${"\n"}`);
  await waitForOutput(chunks, /40 132/, 10_000);
  await terminal.write(`printf real-pty-ok${"\n"}`);
  await waitForOutput(chunks, /real-pty-ok/, 10_000);
  await terminal.write(`exit${"\n"}`);
  const exitEvent = await Promise.race([exit, timeout(10_000, "Real Microsandbox terminal did not exit.")]);
  assert.equal(exitEvent.exitCode, 0);
  assert.match(chunks.join(""), /40 132/);
  assert.match(chunks.join(""), /real-pty-ok/);
  assert.equal(terminal.metadata.shellDialect, "posix-sh");
  assert.equal(terminal.metadata.persistenceScope, "execution-resource");
  assert.equal(terminal.metadata.capabilityProviders?.[SeneraTerminalCapabilityNames.Resize], "guest-node-pty");
  console.log("Real Microsandbox shell and PTY verification passed.");
} finally {
  data.dispose();
  await terminal.signal("kill").catch(() => undefined);
}

async function waitForOutput(chunks: readonly string[], pattern: RegExp, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (!pattern.test(chunks.join(""))) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Timed out waiting for terminal output: ${pattern}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function timeout(milliseconds: number, message: string): Promise<never> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), milliseconds));
}
