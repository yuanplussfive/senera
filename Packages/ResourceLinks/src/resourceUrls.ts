import { buildHttpApiUrl } from "./httpApiUrl";
import { SeneraResourceHttpRoutes } from "./resourceContract";
import { parseResourceId } from "./resourceUri";
import { parseWorkspaceResourceLocator } from "./WorkspaceResourceLocator";

export function buildResourceUploadUrl(httpBaseUrl: string): string {
  const url = new URL(buildHttpApiUrl(httpBaseUrl, SeneraResourceHttpRoutes.Collection));
  url.pathname = SeneraResourceHttpRoutes.Collection;
  url.hash = "";
  return url.toString();
}

/** Interpret model-produced resource links once, independent of the rendering framework. */
export function resolveResourceContentUrl(httpBaseUrl: string, source: string): string | undefined {
  const locator = parseWorkspaceResourceLocator(source);
  return locator
    ? buildWorkspaceResourceUrl(httpBaseUrl, locator.path, true)
    : buildResourceContentUrl(httpBaseUrl, source);
}

export function buildResourceContentUrl(resourceBaseUrl: string, resourceUri: string): string | undefined {
  const resourceId = parseResourceId(resourceUri);
  if (!resourceId) return undefined;
  return buildHttpApiUrl(resourceBaseUrl, `${SeneraResourceHttpRoutes.Collection}/${encodeURIComponent(resourceId)}`);
}

export function buildWorkspaceResourceUrl(httpBaseUrl: string, path: string, raw = false): string {
  const resourceUrl = buildResourceContentUrl(httpBaseUrl, path);
  if (resourceUrl) {
    const url = new URL(resourceUrl);
    if (!raw) url.searchParams.set("view", "metadata");
    return url.toString();
  }
  const url = new URL(
    buildHttpApiUrl(httpBaseUrl, raw ? SeneraResourceHttpRoutes.WorkspaceContent : SeneraResourceHttpRoutes.Collection),
  );
  url.searchParams.set("path", path);
  return url.toString();
}
