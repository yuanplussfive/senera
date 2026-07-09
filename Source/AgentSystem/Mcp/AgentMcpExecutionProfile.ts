import type { SeneraProcessExecutionProfile } from "../Execution/SeneraExecutionProfile.js";
import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";
import { resolveAgentToolExecutionPolicy } from "../ToolRuntime/AgentToolExecutionPolicy.js";

const McpExecutionProfileName = "mcp-stdio-server";

export function buildAgentMcpExecutionProfile(tool: RegisteredTool): SeneraProcessExecutionProfile {
  const policy = resolveAgentToolExecutionPolicy(tool);
  const local = policy.mode === "local";
  return {
    name: McpExecutionProfileName,
    kind: "mcp-server",
    backend: local ? "local" : "sandbox",
    localFallback: policy.localFallback,
    microsandbox: local
      ? undefined
      : {
          network: policy.network,
          workspaceMount: policy.workspaceMount,
        },
  };
}
