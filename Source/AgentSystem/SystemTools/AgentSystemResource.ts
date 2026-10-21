import path from "node:path";
import { AgentResourceResolver } from "../Resources/AgentResourceResolver.js";
import type { AgentLocalResourceSource } from "../Resources/AgentResourceSource.js";
import type { AgentHostToolContext } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";

export interface AgentResolvedSystemLocalResource {
  readonly source: AgentLocalResourceSource;
  readonly resourceUri?: string;
  readonly filePath: string;
  readonly name: string;
  readonly mime: string;
  readonly declaredMime?: string;
  readonly size: number;
  readonly sha256: string;
}

type AgentSystemResourceContext = Pick<
  AgentHostToolContext,
  "config" | "workspaceRoot" | "uploadStore" | "resourceResolver"
>;

export async function resolveAgentSystemLocalResource(
  context: AgentSystemResourceContext,
  source: AgentLocalResourceSource,
): Promise<AgentResolvedSystemLocalResource> {
  if (source.kind === "senera_resource") {
    const resource = await resolveAgentSystemResource(context, source.uri);
    return {
      source: { kind: "senera_resource", uri: resource.resourceUri },
      resourceUri: resource.resourceUri,
      filePath: resource.filePath,
      name: resource.name,
      mime: resource.mime,
      ...(resource.declaredMime ? { declaredMime: resource.declaredMime } : {}),
      size: resource.size,
      sha256: resource.sha256,
    };
  }

  const resolved = await createResourceResolver(context).resolveWorkspacePath?.(source.path);
  if (!resolved) throw new Error("Local resource path is missing or outside the workspace.");
  return {
    source: { kind: "local_path", path: resolveAgentWorkspaceRelativePath(context.workspaceRoot, resolved.filePath) },
    filePath: resolved.filePath,
    name: resolved.name,
    mime: resolved.mime,
    size: resolved.size,
    sha256: resolved.sha256,
  };
}

export function resolveAgentWorkspaceRelativePath(workspaceRoot: string, absolutePath: string): string {
  const relativePath = path.relative(path.resolve(workspaceRoot), absolutePath);
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error("Resolved resource path is outside the workspace.");
  }
  return relativePath.split(path.sep).join("/");
}

export async function resolveAgentSystemResource(context: AgentSystemResourceContext, resourceUri: string) {
  const resolver = createResourceResolver(context);
  const resource = await resolver.resolve(resourceUri);
  if (!resource) throw new Error(`Resource was not found: ${resourceUri}`);
  return resource;
}

function createResourceResolver(context: AgentSystemResourceContext) {
  return (
    context.resourceResolver ??
    new AgentResourceResolver({
      workspaceRoot: context.workspaceRoot,
      config: context.config,
      uploadStore: context.uploadStore ?? {
        resolve: async () => undefined,
      },
    })
  );
}
