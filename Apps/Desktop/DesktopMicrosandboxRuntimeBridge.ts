import type { SeneraMicrosandboxModuleLoader } from "../../Source/AgentSystem/Execution/SeneraMicrosandboxSdkAdapter.js";

export const loadDesktopMicrosandboxModule: SeneraMicrosandboxModuleLoader = () => import("microsandbox");

export const resolveDesktopMicrosandboxPackageEntry = (): string => import.meta.resolve("microsandbox");
