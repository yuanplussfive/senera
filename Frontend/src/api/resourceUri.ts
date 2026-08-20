import { SeneraResourceUriContract } from "./resourceContract";

const ResourceIdPattern = new RegExp(`^${SeneraResourceUriContract.ResourceIdPattern}$`, "u");

export function parseResourceId(value: string): string | undefined {
  let uri: URL;
  try {
    uri = new URL(value);
  } catch {
    return undefined;
  }

  if (
    uri.protocol !== SeneraResourceUriContract.Protocol ||
    uri.username ||
    uri.password ||
    uri.port ||
    uri.search ||
    uri.hash ||
    uri.hostname !== SeneraResourceUriContract.Authority
  ) {
    return undefined;
  }

  const segments = uri.pathname.split("/").filter(Boolean);
  if (segments.length !== 1) return undefined;

  try {
    const resourceId = decodeURIComponent(segments[0] ?? "");
    return ResourceIdPattern.test(resourceId) ? resourceId : undefined;
  } catch {
    return undefined;
  }
}
