import { AgentResourceResolver } from "../Resources/AgentResourceResolver.js";
import type { AgentHostToolContext } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";

export async function resolveAgentSystemResource(
  context: Pick<AgentHostToolContext, "config" | "workspaceRoot" | "uploadStore" | "resourceResolver">,
  resourceUri: string,
) {
  const resolver =
    context.resourceResolver ??
    new AgentResourceResolver({
      workspaceRoot: context.workspaceRoot,
      config: context.config,
      uploadStore: context.uploadStore ?? {
        resolve: async () => undefined,
      },
    });
  const resource = await resolver.resolve(resourceUri);
  if (!resource) throw new Error(`Resource was not found: ${resourceUri}`);
  return resource;
}
