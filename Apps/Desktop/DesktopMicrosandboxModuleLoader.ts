import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SeneraMicrosandboxModuleLoader } from "../../Source/AgentSystem/Execution/SeneraMicrosandboxSdkAdapter.js";
import type { AgentMicrosandboxPackageEntryResolver } from "../../Source/AgentSystem/Sandbox/AgentMicrosandboxCli.js";

interface DesktopMicrosandboxRuntimeBridge {
  loadDesktopMicrosandboxModule: SeneraMicrosandboxModuleLoader;
  resolveDesktopMicrosandboxPackageEntry(): string;
}

export interface DesktopMicrosandboxRuntimeAccess {
  moduleLoader: SeneraMicrosandboxModuleLoader;
  packageEntryResolver: AgentMicrosandboxPackageEntryResolver;
}

export function createDesktopMicrosandboxRuntimeAccess(bridgePath: string): DesktopMicrosandboxRuntimeAccess {
  const bridgeUrl = pathToFileURL(path.resolve(bridgePath)).href;
  let bridgePromise: Promise<DesktopMicrosandboxRuntimeBridge> | undefined;
  const loadBridge = () => (bridgePromise ??= import(bridgeUrl).then(readDesktopMicrosandboxRuntimeBridge));
  return {
    moduleLoader: async () => (await loadBridge()).loadDesktopMicrosandboxModule(),
    packageEntryResolver: async () => (await loadBridge()).resolveDesktopMicrosandboxPackageEntry(),
  };
}

function readDesktopMicrosandboxRuntimeBridge(value: unknown): DesktopMicrosandboxRuntimeBridge {
  if (
    value &&
    typeof value === "object" &&
    "loadDesktopMicrosandboxModule" in value &&
    typeof value.loadDesktopMicrosandboxModule === "function" &&
    "resolveDesktopMicrosandboxPackageEntry" in value &&
    typeof value.resolveDesktopMicrosandboxPackageEntry === "function"
  ) {
    return value as DesktopMicrosandboxRuntimeBridge;
  }
  throw new TypeError("Desktop Microsandbox runtime bridge does not export the required runtime access functions.");
}
