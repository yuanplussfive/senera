import { resolveAgentDefaults } from "../../Source/AgentSystem/AgentDefaults.js";
import { SeneraMicrosandboxBackend } from "../../Source/AgentSystem/Execution/SeneraMicrosandboxBackend.js";
import { probeSeneraMicrosandboxRuntime } from "../../Source/AgentSystem/Execution/SeneraMicrosandboxRuntimeProbe.js";
import { SeneraMicrosandboxDynamicSdkAdapter } from "../../Source/AgentSystem/Execution/SeneraMicrosandboxSdkAdapter.js";
import { resolvePreparedSeneraTerminalSidecarGuestRuntime } from "../../Source/AgentSystem/Execution/SeneraTerminalSidecarGuestRuntime.js";
import { prepareAgentSandboxRuntime } from "../../Source/AgentSystem/Sandbox/AgentSandboxRuntimePreparation.js";
import {
  readAgentSandboxDistributionContract,
  resolveAgentSandboxDistributionTarget,
} from "../../Source/AgentSystem/Sandbox/AgentSandboxDistributionContract.js";
import { createDesktopMicrosandboxRuntimeAccess } from "./DesktopMicrosandboxModuleLoader.js";
import type { DesktopRuntimePaths } from "./DesktopRuntime.js";

export const DesktopMicrosandboxRuntimeSmokeArgument = "--senera-verify-microsandbox-runtime";

export async function runDesktopMicrosandboxRuntimeSmoke(
  paths: DesktopRuntimePaths,
  productVersion: string,
): Promise<void> {
  const config = {
    ...resolveAgentDefaults(undefined).SandboxRuntime,
    BaseDir: paths.sandboxRuntimeRoot,
    Provisioning: { Kind: "ReleaseBundle" as const },
  };
  const microsandboxRuntime = createDesktopMicrosandboxRuntimeAccess(paths.microsandboxRuntimeBridgePath);
  const sandboxTarget = resolveAgentSandboxDistributionTarget(readAgentSandboxDistributionContract());
  const preparation = await prepareAgentSandboxRuntime({
    workspaceRoot: paths.workspaceRoot,
    config,
    productVersion,
    microsandboxModuleLoader: microsandboxRuntime.moduleLoader,
    microsandboxPackageEntryResolver: microsandboxRuntime.packageEntryResolver,
    log: (message) => process.stdout.write(`${message}\n`),
  });
  const backend = new SeneraMicrosandboxBackend({
    workspaceRoot: paths.workspaceRoot,
    settings: { image: sandboxTarget.runtimeImage, pullPolicy: "never" },
    runtimePaths: preparation.paths,
    terminalRuntime: resolvePreparedSeneraTerminalSidecarGuestRuntime(preparation.paths.baseDir),
    sdk: new SeneraMicrosandboxDynamicSdkAdapter(microsandboxRuntime.moduleLoader),
  });
  const result = await probeSeneraMicrosandboxRuntime(backend, paths.workspaceRoot);
  process.stdout.write(`${JSON.stringify({ status: "ok", mode: "desktop-microsandbox", ...result })}\n`);
}
