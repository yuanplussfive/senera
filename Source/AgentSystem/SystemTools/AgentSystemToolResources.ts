import { AgentResolvedUploadResourceSchema, type AgentResolvedUploadResource } from "../Uploads/AgentUploadTypes.js";
import type { AgentHostToolContext } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";

export function requireSystemToolUpload(
  context: AgentHostToolContext,
  binding: string,
  expectedResourceUri: string,
): AgentResolvedUploadResource {
  const upload = AgentResolvedUploadResourceSchema.parse(context.resources?.[binding]);
  if (upload.resourceUri !== expectedResourceUri) {
    throw new Error(`Resolved resource ${binding} does not match ${expectedResourceUri}.`);
  }
  return upload;
}
