/** Removes deleted physical evidence while preserving records backed by other sources. */
export function pruneAgentContinuitySourceReferences(
  sourceRefs: readonly string[],
  deletedSourceUris: ReadonlySet<string>,
): readonly string[] | undefined {
  const normalized = [...new Set(sourceRefs.map((ref) => ref.trim()).filter(Boolean))];
  if (!normalized.some((ref) => deletedSourceUris.has(ref))) return normalized;
  const remaining = normalized.filter((ref) => !deletedSourceUris.has(ref));
  return remaining.length > 0 ? remaining : undefined;
}
