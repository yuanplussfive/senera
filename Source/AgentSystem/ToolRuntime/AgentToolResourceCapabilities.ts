import { resolveUploadsConfig } from "../AgentDefaults.js";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { AgentUploadStore } from "../Uploads/AgentUploadStore.js";
import { AgentToolResourceCapabilityRegistry } from "./AgentToolResourceCapabilityRegistry.js";
import { AgentToolUploadReadResourceCapability } from "./AgentToolUploadReadResourceCapability.js";
import { AgentToolWorkspacePathResourceCapability } from "./AgentToolWorkspacePathResourceCapability.js";
import type { AgentResourceAccessRequest } from "../Execution/SeneraResourceAccess.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";
import { readAgentJsonPointer } from "../Core/AgentJsonPointerOperations.js";

export async function inspectAgentToolResourceAccess(
  tool: RegisteredTool,
  args: Readonly<Record<string, unknown>>,
  capabilities: AgentToolResourceCapabilityRegistry,
): Promise<{
  readonly requests: readonly AgentResourceAccessRequest[];
  readonly external: readonly AgentResourceAccessRequest[];
}> {
  const requests = (
    await Promise.all(
      (tool.handler.resources ?? []).map(async (resource) => {
        const value = readAgentJsonPointer(args, resource.Pointer);
        if (!value.found) return [];
        return capabilities.inspect(resource, value.value, args);
      }),
    )
  ).flat();
  return {
    requests,
    external: requests.filter((request) => request.facts.containment === "outside"),
  };
}

export function createAgentDefaultToolResourceCapabilities(input: {
  config: AgentSystemConfig;
  workspaceRoot: string;
  executionEnv: Pick<SeneraExecutionEnv, "resolveResourcePath" | "inspectResourcePath">;
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
