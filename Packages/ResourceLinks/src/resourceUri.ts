import { SeneraResourceUriContract } from "./resourceContract";

const ResourceIdPattern = new RegExp(`^${SeneraResourceUriContract.ResourceIdPattern}$`, "u");
const ResourceUriPrefix = `${SeneraResourceUriContract.Protocol}//${SeneraResourceUriContract.Authority}/`;

/** Internal references use the transport grammar, independent of WebView URL parsing and path normalization. */
export function parseResourceId(value: string): string | undefined {
  if (!value.startsWith(ResourceUriPrefix)) return undefined;
  const resourceId = value.slice(ResourceUriPrefix.length);
  return ResourceIdPattern.exec(resourceId)?.[0] === resourceId ? resourceId : undefined;
}
