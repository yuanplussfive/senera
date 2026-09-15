/** A scored list from one independent lexical view. */
export interface AgentContinuityScoreList {
  readonly scores: ReadonlyMap<string, number>;
  readonly weight?: number;
}

export const AgentContinuityScoreFusionDefaults = Object.freeze({
  rrfK: 60,
});

/**
 * Reciprocal-rank fusion for independent local views. Raw scores from a
 * single view are preserved exactly; multiple views are normalized against
 * their own best possible contribution and retain the strongest raw signal.
 * This makes a context/feedback view additive instead of allowing it to
 * dilute an exact lexical hit.
 */
export function fuseAgentContinuityScoreLists(
  lists: readonly AgentContinuityScoreList[],
  options: { readonly rrfK?: number } = {},
): ReadonlyMap<string, number> {
  const usable = lists
    .map((list) => ({
      weight: Number.isFinite(list.weight) && (list.weight ?? 0) > 0 ? (list.weight as number) : 1,
      entries: [...list.scores.entries()]
        .filter(([, score]) => Number.isFinite(score) && score > 0)
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])),
    }))
    .filter((list) => list.entries.length > 0);
  if (usable.length === 0) return new Map();
  if (usable.length === 1) return new Map(usable[0]!.entries);

  const rrfK =
    Number.isFinite(options.rrfK) && (options.rrfK ?? 0) > 0
      ? (options.rrfK as number)
      : AgentContinuityScoreFusionDefaults.rrfK;
  const rawMaximum = Math.max(...usable.flatMap((list) => list.entries.map(([, score]) => score)), 0);
  const maximumRrf = usable.reduce((sum, list) => sum + list.weight / (rrfK + 1), 0);
  const fused = new Map<string, { readonly raw: number; rrf: number }>();
  for (const list of usable) {
    list.entries.forEach(([id, score], index) => {
      const current = fused.get(id) ?? { raw: 0, rrf: 0 };
      fused.set(id, {
        raw: Math.max(current.raw, score),
        rrf: current.rrf + list.weight / (rrfK + index + 1),
      });
    });
  }
  return new Map(
    [...fused.entries()]
      .map(
        ([id, value]) => [id, Math.max(value.raw, maximumRrf > 0 ? (value.rrf / maximumRrf) * rawMaximum : 0)] as const,
      )
      .map(([id, score]) => [id, clamp01(score)] as const),
  );
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
