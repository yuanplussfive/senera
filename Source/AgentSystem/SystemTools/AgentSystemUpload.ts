import { resolveUploadsConfig } from "../AgentDefaults.js";
import type { AgentHostToolContext } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { AgentUploadStore } from "../Uploads/AgentUploadStore.js";
import type { AgentResolvedUpload } from "../Uploads/AgentUploadTypes.js";

export async function resolveAgentSystemUpload(
  context: Pick<AgentHostToolContext, "config" | "workspaceRoot" | "uploadStore">,
  uploadUri: string,
): Promise<AgentResolvedUpload> {
  const store =
    context.uploadStore ??
    new AgentUploadStore({
      workspaceRoot: context.workspaceRoot,
      config: resolveUploadsConfig(context.config),
    });
  const upload = await store.resolve(uploadUri);
  if (!upload) throw new Error(`Upload was not found: ${uploadUri}`);
  return upload;
}
