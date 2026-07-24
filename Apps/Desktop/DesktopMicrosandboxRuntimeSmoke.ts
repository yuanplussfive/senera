import { resolveAgentDefaults } from "../../Source/AgentSystem/AgentDefaults.js";
import { SeneraMicrosandboxBackend } from "../../Source/AgentSystem/Execution/SeneraMicrosandboxBackend.js";
import { probeSeneraMicrosandboxRuntime } from "../../Source/AgentSystem/Execution/SeneraMicrosandboxRuntimeProbe.js";
import { SeneraMicrosandboxDynamicSdkAdapter } from "../../Source/AgentSystem/Execution/SeneraMicrosandboxSdkAdapter.js";
import { resolvePreparedSeneraTerminalSidecarGuestRuntime } from "../../Source/AgentSystem/Execution/SeneraTerminalSidecarGuestRuntime.js";
import { prepareAgentSandboxRuntime } from "../../Source/AgentSystem/Sandbox/AgentSandboxRuntimePreparation.js";
import { createDesktopMicrosandboxModuleLoader } from "./DesktopMicrosandboxModuleLoader.js";
import type { DesktopRuntimePaths } from "./DesktopRuntime.js";

export const DesktopMicrosandboxRuntimeSmokeArgument = "--senera-verify-microsandbox-runtime";

export async function runDesktopMicrosandboxRuntimeSmoke(paths: DesktopRuntimePaths): Promise<void> {
  const config = {
    ...resolveAgentDefaults(undefined).SandboxRuntime,
    BaseDir: paths.sandboxRuntimeRoot,
  };
  const microsandboxModuleLoader = createDesktopMicrosandboxModuleLoader(paths.microsandboxRuntimeBridgePath);
  const preparation = await prepareAgentSandboxRuntime({
    workspaceRoot: paths.workspaceRoot,
    config,
    strict: true,
    microsandboxModuleLoader,
    log: (message) => process.stdout.write(`${message}\n`),
  });
  const backend = new SeneraMicrosandboxBackend({
    workspaceRoot: paths.workspaceRoot,
    runtimePaths: preparation.paths,
    terminalRuntime: resolvePreparedSeneraTerminalSidecarGuestRuntime(preparation.paths.baseDir),
    sdk: new SeneraMicrosandboxDynamicSdkAdapter(microsandboxModuleLoader),
  });
  const result = await probeSeneraMicrosandboxRuntime(backend, paths.workspaceRoot);
  process.stdout.write(`${JSON.stringify({ status: "ok", mode: "desktop-microsandbox", ...result })}\n`);
}
