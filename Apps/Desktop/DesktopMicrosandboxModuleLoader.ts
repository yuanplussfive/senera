import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SeneraMicrosandboxModuleLoader } from "../../Source/AgentSystem/Execution/SeneraMicrosandboxSdkAdapter.js";

interface DesktopMicrosandboxRuntimeBridge {
  loadDesktopMicrosandboxModule: SeneraMicrosandboxModuleLoader;
}

export function createDesktopMicrosandboxModuleLoader(bridgePath: string): SeneraMicrosandboxModuleLoader {
  const bridgeUrl = pathToFileURL(path.resolve(bridgePath)).href;
  let bridgePromise: Promise<DesktopMicrosandboxRuntimeBridge> | undefined;
  return async () => {
    bridgePromise ??= import(bridgeUrl).then(readDesktopMicrosandboxRuntimeBridge);
    return (await bridgePromise).loadDesktopMicrosandboxModule();
  };
}

function readDesktopMicrosandboxRuntimeBridge(value: unknown): DesktopMicrosandboxRuntimeBridge {
  if (
    value &&
    typeof value === "object" &&
    "loadDesktopMicrosandboxModule" in value &&
    typeof value.loadDesktopMicrosandboxModule === "function"
  ) {
    return value as DesktopMicrosandboxRuntimeBridge;
  }
  throw new TypeError("Desktop Microsandbox runtime bridge does not export loadDesktopMicrosandboxModule().");
}
