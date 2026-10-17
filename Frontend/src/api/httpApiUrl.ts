export function buildHttpApiUrl(httpBaseUrl: string, pathname: string): string {
  const url = new URL(httpBaseUrl, window.location.href);
  if (url.protocol === "ws:" || url.protocol === "wss:") {
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  }
  url.pathname = pathname;
  const workspaceId = url.searchParams.get("workspaceId");
  url.search = "";
  if (workspaceId) url.searchParams.set("workspaceId", workspaceId);
  url.hash = "";
  url.username = "";
  url.password = "";
  return url.toString();
}
