import { resolveUploadsConfig } from "../AgentDefaults.js";
import type { AgentHostToolContext } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { AgentUploadStore } from "../Uploads/AgentUploadStore.js";
import type { AgentResolvedUpload } from "../Uploads/AgentUploadTypes.js";

export async function resolveAgentSystemUpload(
  context: Pick<AgentHostToolContext, "config" | "workspaceRoot" | "uploadStore">,
  resourceUri: string,
): Promise<AgentResolvedUpload> {
  const store =
    context.uploadStore ??
    new AgentUploadStore({
      workspaceRoot: context.workspaceRoot,
      config: resolveUploadsConfig(context.config),
    });
  const upload = await store.resolve(resourceUri);
  if (!upload) throw new Error(`Resource was not found: ${resourceUri}`);
  return upload;
}
