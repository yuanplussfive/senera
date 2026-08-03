import { resolveUploadsConfig } from "../AgentDefaults.js";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { AgentUploadStore } from "../Uploads/AgentUploadStore.js";
import { AgentToolResourceCapabilityRegistry } from "./AgentToolResourceCapabilityRegistry.js";
import { AgentToolUploadReadResourceCapability } from "./AgentToolUploadReadResourceCapability.js";
import { AgentToolWorkspacePathResourceCapability } from "./AgentToolWorkspacePathResourceCapability.js";

export function createAgentDefaultToolResourceCapabilities(input: {
  config: AgentSystemConfig;
  workspaceRoot: string;
  executionEnv: Pick<SeneraExecutionEnv, "resolveResourcePath">;
  uploadStore?: AgentUploadStore;
}): AgentToolResourceCapabilityRegistry {
  const uploads =
    input.uploadStore ??
    new AgentUploadStore({
      workspaceRoot: input.workspaceRoot,
      config: resolveUploadsConfig(input.config),
    });
  return new AgentToolResourceCapabilityRegistry()
    .register(new AgentToolWorkspacePathResourceCapability(input.executionEnv))
    .register(new AgentToolUploadReadResourceCapability(uploads));
}
