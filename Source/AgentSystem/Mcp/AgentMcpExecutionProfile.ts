import type { SeneraProcessExecutionProfile } from "../Execution/SeneraExecutionProfile.js";
import type {
  SeneraProcessBackendPreference,
  SeneraProcessNetworkMode,
  SeneraProcessWorkspaceMountMode,
} from "../Execution/SeneraExecutionProfile.js";

const McpExecutionProfileName = "mcp-stdio-server";

export function createAgentMcpExecutionProfile(input: {
  backend: SeneraProcessBackendPreference;
  network: SeneraProcessNetworkMode;
  workspaceMount: SeneraProcessWorkspaceMountMode;
  packageRoot?: string;
}): SeneraProcessExecutionProfile {
  const local = input.backend === "local";
  return {
    name: McpExecutionProfileName,
    kind: "mcp-server",
    backend: input.backend,
    hostCwdRoot: input.packageRoot,
    sandbox: local
      ? undefined
      : {
          network: input.network,
          workspaceMount: input.workspaceMount,
        },
  };
}
