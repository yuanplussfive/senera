export function resolveWorkspaceScopedHttpBaseUrl(httpBaseUrl: string, workspaceId?: string | null): string {
  const url = new URL(httpBaseUrl, window.location.href);
  if (workspaceId) url.searchParams.set("workspaceId", workspaceId);
  else url.searchParams.delete("workspaceId");
  return url.toString();
}
