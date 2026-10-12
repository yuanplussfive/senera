/** Shared HTTP/WebSocket scope contract. Paths are resolved only by the workspace owner. */
export const AgentWorkspaceScopeParameter = "workspaceId";

export function scopeAgentWorkspaceUrl(value: string, workspaceId: string): string {
  const url = new URL(value);
  url.searchParams.set(AgentWorkspaceScopeParameter, workspaceId);
  return url.toString();
}
