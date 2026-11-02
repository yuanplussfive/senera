import path from "node:path";
import { relativePathWithin } from "../Core/AgentPath.js";
import { AgentResourceAccessIntents } from "../Execution/SeneraResourceAccess.js";
import { AgentResourceResolver, type AgentResourceOrigin } from "../Resources/AgentResourceResolver.js";
import type { AgentLocalResourceSource } from "../Resources/AgentResourceSource.js";
import type { AgentHostToolContext } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";

interface AgentResolvedSystemLocalResourceFields {
  readonly filePath: string;
  readonly name: string;
  readonly mime: string;
  readonly declaredMime?: string;
  readonly size: number;
  readonly sha256: string;
}

/** A canonical resource together with the storage that actually owns its bytes. */
export interface AgentResolvedSystemResource extends AgentResolvedSystemLocalResourceFields {
  readonly source: Extract<AgentLocalResourceSource, { kind: "senera_resource" }>;
  readonly resourceUri: string;
  readonly origin: AgentResourceOrigin;
}

export interface AgentResolvedSystemWorkspaceResource extends AgentResolvedSystemLocalResourceFields {
  readonly source: Extract<AgentLocalResourceSource, { kind: "local_path" }>;
  readonly resourceUri?: undefined;
  readonly origin?: undefined;
}

export type AgentResolvedSystemLocalResource = AgentResolvedSystemResource | AgentResolvedSystemWorkspaceResource;

type AgentSystemResourceContext = Pick<
  AgentHostToolContext,
  "config" | "workspaceRoot" | "uploadStore" | "resourceResolver" | "executionEnv" | "resourceAccessGrant"
>;

export async function resolveAgentSystemLocalResource(
  context: AgentSystemResourceContext,
  source: AgentLocalResourceSource,
): Promise<AgentResolvedSystemLocalResource> {
  if (source.kind === "senera_resource") {
    const resource = await resolveAgentSystemResource(context, source.uri);
    return {
      source: {
        kind: "senera_resource",
        uri: resource.resourceUri,
        ...workspaceRelativePath(context, resource.filePath),
      },
      resourceUri: resource.resourceUri,
      origin: resource.origin,
      filePath: resource.filePath,
      name: resource.name,
      mime: resource.mime,
      ...(resource.declaredMime ? { declaredMime: resource.declaredMime } : {}),
      size: resource.size,
      sha256: resource.sha256,
    };
  }

  const authorizedPath = await context.executionEnv.resolveResourcePath(source.path, AgentResourceAccessIntents.Read);
  if (!authorizedPath.ok) throw authorizedPath.error;
  const resolved = await createResourceResolver(context).resolveWorkspacePath?.(
    authorizedPath.value,
    context.resourceAccessGrant,
  );
  if (!resolved) throw new Error(`Local resource was not found: ${source.path}`);
  const relativePath = relativePathWithin(context.workspaceRoot, resolved.filePath);
  return {
    source: { kind: "local_path", path: (relativePath ?? resolved.filePath).split(path.sep).join("/") },
    filePath: resolved.filePath,
    name: resolved.name,
    mime: resolved.mime,
    size: resolved.size,
    sha256: resolved.sha256,
  };
}

/**
 * Senera resources live in the workspace artifact or upload directories, so the
 * model can usually be handed the file itself. An external upload store is the
 * exception, and there the URI stays the only usable identity.
 */
function workspaceRelativePath(
  context: AgentSystemResourceContext,
  filePath: string,
): { path: string } | Record<never, never> {
  const relativePath = relativePathWithin(context.workspaceRoot, filePath);
  return relativePath ? { path: relativePath.split(path.sep).join("/") } : {};
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
