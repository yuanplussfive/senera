import { resolveUploadsConfig } from "../AgentDefaults.js";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { AgentUploadStore } from "../Uploads/AgentUploadStore.js";
import { AgentMcpResourceCapabilityRegistry } from "./AgentMcpResourceCapabilityRegistry.js";
import { AgentMcpUploadReadResourceCapability } from "./AgentMcpUploadReadResourceCapability.js";
import { AgentMcpWorkspacePathResourceCapability } from "./AgentMcpWorkspacePathResourceCapability.js";

export function createAgentMcpDefaultResourceCapabilities(input: {
  config: AgentSystemConfig;
  workspaceRoot: string;
  executionEnv: Pick<SeneraExecutionEnv, "resolveResourcePath">;
}): AgentMcpResourceCapabilityRegistry {
  const uploads = new AgentUploadStore({
    workspaceRoot: input.workspaceRoot,
    config: resolveUploadsConfig(input.config),
  });
  return new AgentMcpResourceCapabilityRegistry()
    .register(new AgentMcpWorkspacePathResourceCapability(input.executionEnv))
    .register(new AgentMcpUploadReadResourceCapability(uploads));
}
