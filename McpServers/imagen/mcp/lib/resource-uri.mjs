const RESOURCE_AUTHORITY = "resource";

export function createResourceUri(resourceId) {
  const encoded = encodeURIComponent(String(resourceId).trim());
  return `senera://${RESOURCE_AUTHORITY}/${encoded}`;
}
