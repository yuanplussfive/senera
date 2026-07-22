import type { SeneraProcessExecutionProfile } from "../Execution/SeneraExecutionProfile.js";
import type { RegisteredTool } from "../Types/PluginRuntimeTypes.js";
import type { AgentToolExecutionPlan } from "../ToolRuntime/AgentToolExecutionPlan.js";

const McpExecutionProfileName = "mcp-stdio-server";

export function buildAgentMcpExecutionProfile(
  tool: RegisteredTool,
  executionPlan: AgentToolExecutionPlan,
): SeneraProcessExecutionProfile {
  const local = executionPlan.backend === "local";
  return {
    name: McpExecutionProfileName,
    kind: "mcp-server",
    backend: executionPlan.backend,
    microsandbox: local
      ? undefined
      : {
          network: executionPlan.network,
          workspaceMount: executionPlan.workspaceMount,
        },
  };
}
