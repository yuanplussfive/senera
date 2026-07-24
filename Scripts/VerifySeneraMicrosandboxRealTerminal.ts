import { resolveAgentDefaults } from "../Source/AgentSystem/AgentDefaults.js";
import { SeneraMicrosandboxBackend } from "../Source/AgentSystem/Execution/SeneraMicrosandboxBackend.js";
import { probeSeneraMicrosandboxRuntime } from "../Source/AgentSystem/Execution/SeneraMicrosandboxRuntimeProbe.js";
import { SeneraMicrosandboxDynamicSdkAdapter } from "../Source/AgentSystem/Execution/SeneraMicrosandboxSdkAdapter.js";
import { resolvePreparedSeneraTerminalSidecarGuestRuntime } from "../Source/AgentSystem/Execution/SeneraTerminalSidecarGuestRuntime.js";
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

await probeSeneraMicrosandboxRuntime(backend, workspaceRoot);
console.log("Real Microsandbox shell and PTY verification passed.");
