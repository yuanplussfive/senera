import type { SeneraMicrosandboxModuleLoader } from "../../Source/AgentSystem/Execution/SeneraMicrosandboxSdkAdapter.js";

export const loadDesktopMicrosandboxModule: SeneraMicrosandboxModuleLoader = () => import("microsandbox");
