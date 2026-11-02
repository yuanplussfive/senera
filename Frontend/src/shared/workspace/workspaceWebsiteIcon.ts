/** Website identity comes from the visited site, never from a third-party icon service. */
export function readWorkspaceWebsiteIcon(value: string, pageUrl: string): string | undefined {
  try {
    const url = new URL(value, pageUrl);
    if (url.username || url.password) return undefined;
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
    if (url.protocol === "data:" && /^data:image\//iu.test(url.href)) return url.href;
  } catch {
    return undefined;
  }
  return undefined;
}

/** Standard favicon location for frames whose cross-origin document cannot be inspected. */
export function workspaceWebsiteIconUrl(pageUrl: string): string | undefined {
  return readWorkspaceWebsiteIcon("/favicon.ico", pageUrl);
}
