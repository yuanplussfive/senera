import { AgentResolvedUploadResourceSchema, type AgentResolvedUploadResource } from "../Uploads/AgentUploadTypes.js";
import type { AgentHostToolContext } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";

export function requireSystemToolUpload(
  context: AgentHostToolContext,
  binding: string,
  expectedUploadUri: string,
): AgentResolvedUploadResource {
  const upload = AgentResolvedUploadResourceSchema.parse(context.resources?.[binding]);
  if (upload.uploadUri !== expectedUploadUri) {
    throw new Error(`Resolved upload ${binding} does not match ${expectedUploadUri}.`);
  }
  return upload;
}
