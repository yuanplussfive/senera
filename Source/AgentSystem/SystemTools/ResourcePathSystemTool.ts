import { z } from "zod";
import { AgentResourceUriSchema } from "../Resources/AgentResourceSchema.js";
import { defineSystemTool } from "./AgentSystemToolDefinition.js";
import { resolveAgentSystemResource, resolveAgentWorkspaceRelativePath } from "./AgentSystemResource.js";

const ResourcePathInput = z
  .object({
    resourceUri: AgentResourceUriSchema.describe("Canonical Senera resource identity to resolve on this workspace."),
  })
  .strict();

const ResourcePathOutput = z
  .object({
    source: z
      .object({
        kind: z.literal("local_path"),
        path: z.string().min(1),
      })
      .strict(),
    name: z.string(),
    mime: z.string(),
    size: z.number().int().nonnegative(),
    sha256: z.string().min(1),
  })
  .strict();

export const ResourcePathSystemTool = defineSystemTool({
  extension: {
    name: "agent-resource-tools",
    displayName: { "zh-CN": "资源访问", "en-US": "Resource Access" },
    description: {
      "zh-CN": "将 Senera 资源标识解析为当前工作区内可直接读取的本地路径。",
      "en-US": "Resolves a Senera resource identity to a directly readable local path in the active workspace.",
    },
    priority: 8,
  },
  metadata: {
    loading: "Bootstrap",
    description:
      "Resolve a canonical Senera resource URI to its existing workspace-relative local path and verified media metadata. This does not copy or modify the resource.",
    permissions: ["resources:read"],
    execution: { Targets: ["Local"], Network: "Deny", Workspace: "ReadOnly" },
    search: {
      Summary: "把 senera://resource URI 解析为本机可直接读取的工作区相对路径和文件信息。",
      Tags: ["resource", "path", "upload", "media"],
      Capabilities: [
        {
          Id: "resource.resolve-local-path",
          Title: "Resolve local resource path",
          Description: "查找已保存的 Senera 上传或 Artifact 资源，并返回经过校验的工作区相对路径。",
          Facets: {
            Actions: ["resolve", "locate", "read"],
            Targets: ["uploaded-resource", "artifact-resource"],
            Inputs: ["resource-uri"],
            Outputs: ["workspace-relative-path", "mime", "size", "sha256"],
            Effects: ["none"],
          },
          Aliases: ["解析资源路径", "读取资源路径", "获取本地资源路径", "resolve resource path"],
          Risk: { SideEffect: "read-only", Permission: "resources-read" },
        },
      ],
      UseCases: ["已经获得 Senera 资源 URI，并需要把对应文件交给本机工具读取。"],
      Avoid: ["不要从路径猜测或构造 Senera URI；需要分析图片或文档时直接使用对应资源工具。"],
    },
  },
  name: "ResourcePath",
  input: ResourcePathInput,
  output: ResourcePathOutput,
  async execute(input, context) {
    const resource = await resolveAgentSystemResource(context, input.resourceUri);
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
