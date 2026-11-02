/**
 * Transaction-local asset reference, resolved by the Artifact recorder before
 * publication. It deliberately cannot be mistaken for a durable resource URI.
 */
export function createAgentArtifactAssetLink(assetId: string): string {
  return `asset:${encodeURIComponent(assetId)}/`;
}
