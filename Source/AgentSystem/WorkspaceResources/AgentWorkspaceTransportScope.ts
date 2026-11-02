import { AgentWorkspaceIdSchema, type AgentWorkspaceId } from "./AgentWorkspaceCatalogContract.js";

/** Shared HTTP/WebSocket scope contract. Paths are resolved only by the workspace owner. */
export const AgentWorkspaceScopeParameter = "workspaceId";

export function scopeAgentWorkspaceUrl(value: string, workspaceId: AgentWorkspaceId): string {
  const url = new URL(value);
  url.searchParams.set(AgentWorkspaceScopeParameter, AgentWorkspaceIdSchema.parse(workspaceId));
  return url.toString();
}
