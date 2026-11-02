import { AgentWorkspaceIdSchema } from "../WorkspaceResources/AgentWorkspaceCatalogContract.js";

export const AgentOneBot11ClientPrefix = "/api/channel-clients/onebot11/";
export const AgentOneBot11ClientSocketPath = "socket";

export function agentOneBot11ClientPath(workspaceId: string): string {
  return `${AgentOneBot11ClientPrefix}${AgentWorkspaceIdSchema.parse(workspaceId)}/`;
}

export function readAgentOneBot11ClientRoute(
  pathname: string,
): { readonly workspaceId: string; readonly root: string; readonly resource: string } | undefined {
  if (!pathname.startsWith(AgentOneBot11ClientPrefix)) return undefined;
  const suffix = pathname.slice(AgentOneBot11ClientPrefix.length);
  const separator = suffix.indexOf("/");
  if (separator < 0) return undefined;
  const identity = AgentWorkspaceIdSchema.safeParse(suffix.slice(0, separator));
  if (!identity.success) return undefined;
  return {
    workspaceId: identity.data,
    root: agentOneBot11ClientPath(identity.data),
    resource: suffix.slice(separator + 1),
  };
}
