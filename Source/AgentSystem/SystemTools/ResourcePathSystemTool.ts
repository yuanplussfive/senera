import { defineSystemTool, systemToolArguments } from "./AgentSystemToolDefinition.js";
import { resolveAgentSystemResource, resolveAgentWorkspaceRelativePath } from "./AgentSystemResource.js";

interface ResourcePathArguments extends Record<string, unknown> {
  readonly resourceUri: string;
}

export const ResourcePathSystemTool = defineSystemTool({
  capability: "system.tool.agent-resource-tools.ResourcePath",
  async execute(input, context) {
    const { resourceUri } = systemToolArguments<ResourcePathArguments>(input);
    const resource = await resolveAgentSystemResource(context, resourceUri);
    return {
      source: {
        kind: "local_path" as const,
        path: resolveAgentWorkspaceRelativePath(context.workspaceRoot, resource.filePath),
      },
      name: resource.name,
      mime: resource.mime,
      size: resource.size,
      sha256: resource.sha256,
    };
  },
});
