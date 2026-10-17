import path from "node:path";
import type { SeneraProcessExecutionProfile } from "../Execution/SeneraExecutionProfile.js";
import type {
  SeneraProcessBackendPreference,
  SeneraProcessNetworkMode,
  SeneraProcessWorkspaceMountMode,
} from "../Execution/SeneraExecutionProfile.js";

const McpExecutionProfileName = "mcp-stdio-server";
export const AgentMcpSandboxPackageGuestRoot = "/opt/senera/mcp-packages";

export function createAgentMcpExecutionProfile(input: {
  backend: SeneraProcessBackendPreference;
  network: SeneraProcessNetworkMode;
  workspaceMount: SeneraProcessWorkspaceMountMode;
  packageRoot?: string;
  packageName?: string;
}): SeneraProcessExecutionProfile {
  const local = input.backend === "local";
  const packageRoot = input.packageRoot ? path.resolve(input.packageRoot) : undefined;
  const packageName = input.packageName?.trim();
  if (!local && packageRoot && !packageName) {
    throw new Error("Sandbox MCP execution requires the package name when a package root is provided.");
  }
  const packageGuestRoot =
    !local && packageRoot && packageName
      ? path.posix.join(AgentMcpSandboxPackageGuestRoot, encodeURIComponent(packageName))
      : undefined;
  return {
    name: McpExecutionProfileName,
    kind: "mcp-server",
    backend: input.backend,
    hostCwdRoot: packageRoot,
    sandbox: local
      ? undefined
      : {
          network: input.network,
          workspaceMount: input.workspaceMount,
          ...(packageRoot && packageGuestRoot
            ? {
                rootfsCopies: [
                  {
                    hostPath: packageRoot,
                    guestPath: packageGuestRoot,
                  },
                ],
              }
            : {}),
        },
  };
}
