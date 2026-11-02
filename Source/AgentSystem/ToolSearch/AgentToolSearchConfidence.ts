import type { AgentToolSearchDiscovery, AgentToolSearchResult } from "./AgentToolSearchTypes.js";

export interface AgentToolSearchScoredEntry {
  readonly score: number;
}

export interface AgentToolSearchDiscoveryPlanningOptions {
  /**
   * Evidence derived from producer declarations and the current request.
   * These names are not a manually curated allow-list: the index computes
   * them from the same immutable documents used by ranking.
   */
  readonly directMatchNames?: ReadonlySet<string>;
}

export interface AgentToolSearchScoreCurve<Entry extends AgentToolSearchScoredEntry> {
  /** Entries sorted by descending score before segmentation. */
  readonly ordered: readonly Entry[];
  /**
   * Query-relative score bands selected by penalized least squares. There
   * are at most three bands because the public discovery protocol has three
   * semantic states: match, maybe, and omitted. This is not a result-count
   * limit.
   */
  readonly bands: readonly (readonly Entry[])[];
}

interface CandidateEvidence {
  readonly result: AgentToolSearchResult;
  readonly atoms: readonly string[];
}

/**
 * Partitions a sorted score curve with a BIC-penalized change-point model.
 *
 * Scores from different retrieval channels are fused before reaching this
 * function, so it deliberately reasons only about their current query's
 * shape. A flat curve stays one band; a leading cluster must reduce the
 * normalized residual error enough to pay for another segment. Unlike a
 * largest-gap rule, this can retain a middle band without inventing a fixed
 * number of visible candidates.
 */
export function partitionAgentToolSearchScoreCurve<Entry extends AgentToolSearchScoredEntry>(
  entries: readonly Entry[],
): AgentToolSearchScoreCurve<Entry> {
  const ordered = [...entries]
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score);
  if (ordered.length < 3 || isFlat(ordered.map((entry) => entry.score))) {
    return { ordered, bands: ordered.length > 0 ? [ordered] : [] };
  }

  const scores = ordered.map((entry) => entry.score);
  const scale = scoreScale(scores);
  const partitions = Array.from({ length: Math.min(3, ordered.length) }, (_, index) =>
    optimalPartition(scores, index + 1, scale),
  );
  const best = partitions
    .filter((partition): partition is ScorePartition => partition !== undefined)
    .sort((left, right) => left.criterion - right.criterion || left.boundaries.length - right.boundaries.length)[0];
  if (!best) return { ordered, bands: [ordered] };

  const bands: Entry[][] = [];
  let start = 0;
  for (const end of [...best.boundaries, ordered.length]) {
    const band = ordered.slice(start, end);
    if (band.length > 0) bands.push(band);
    start = end;
  }
  return { ordered, bands };
}

/**
 * Assigns one unified candidate set to the model-facing tiers. No tool name,
 * provider, query language, or absolute similarity threshold participates in
 * this decision. The curve decides disclosure bands; a `match` additionally
 * needs either a unique producer-declared proof or an isolated semantic lead.
 * This keeps a generic lexical spike from acquiring execution authority while
 * still allowing a genuinely separated local-vector result to be actionable.
 */
export function planAgentToolSearchDiscovery(
  results: readonly AgentToolSearchResult[],
  options: AgentToolSearchDiscoveryPlanningOptions = {},
): AgentToolSearchDiscovery {
  const evidence = results
    .filter((result) => Number.isFinite(result.score))
    .map((result) => ({ result, atoms: evidenceAtoms(result) }));
  const curve = partitionAgentToolSearchScoreCurve(evidence.map((entry) => ({ ...entry, score: entry.result.score })));
  const bands = curve.bands.map((band) => band.map(({ result, atoms }) => ({ result, atoms })));
  const [high = [], middle = [], low = []] = bands;
  const directMatchNames = options.directMatchNames ?? new Set<string>();
  const semanticLeadNames = isolatedSemanticLeaderNames(evidence);
  const matchEvidence = evidence.filter(
    (entry) => directMatchNames.has(entry.result.toolName) || semanticLeadNames.has(entry.result.toolName),
  );
  const orderedMatch = orderByMarginalCoverage(matchEvidence);
  const matchNames = new Set(orderedMatch.map((entry) => entry.result.toolName));
  const covered = new Set(orderedMatch.flatMap((entry) => entry.atoms));
  const maybeEvidence = orderByMarginalCoverage(
    [...high, ...middle].filter((entry) => !matchNames.has(entry.result.toolName)),
    covered,
  );
  const omitted = orderByMarginalCoverage(
    low.filter((entry) => !matchNames.has(entry.result.toolName)),
    new Set([...covered, ...maybeEvidence.flatMap((entry) => entry.atoms)]),
  );

  return {
    match: orderedMatch.map((entry) => entry.result),
    maybe: maybeEvidence.map((entry) => entry.result),
    omitted: omitted.map((entry) => entry.result),
  };
}

interface ScorePartition {
  readonly boundaries: readonly number[];
  readonly criterion: number;
}

function optimalPartition(scores: readonly number[], segmentCount: number, scale: number): ScorePartition | undefined {
  const count = scores.length;
  const costs = new Map<string, number>();
  const segmentCost = (start: number, end: number) => {
    const key = `${start}:${end}`;
    const cached = costs.get(key);
    if (cached !== undefined) return cached;
    const values = scores.slice(start, end);
    const mean = values.reduce((total, value) => total + value, 0) / values.length;
    const residual = values.reduce((total, value) => total + (value - mean) ** 2, 0);
    const value = residual / (scale * scale);
    costs.set(key, value);
    return value;
  };
  const states = Array.from({ length: segmentCount + 1 }, () => Array<number | undefined>(count + 1));
  const previous = Array.from({ length: segmentCount + 1 }, () => Array<number | undefined>(count + 1));
  states[0]![0] = 0;

  for (let segment = 1; segment <= segmentCount; segment += 1) {
    for (let end = segment; end <= count; end += 1) {
      let best: number | undefined;
      let bestStart: number | undefined;
      for (let start = segment - 1; start < end; start += 1) {
        const prior = states[segment - 1]?.[start];
        if (prior === undefined) continue;
        const candidate = prior + segmentCost(start, end);
        if (best === undefined || candidate < best) {
          best = candidate;
          bestStart = start;
        }
      }
      states[segment]![end] = best;
      previous[segment]![end] = bestStart;
    }
  }

  const residual = states[segmentCount]?.[count];
  if (residual === undefined) return undefined;
  const boundaries: number[] = [];
  let segment = segmentCount;
  let end = count;
  while (segment > 1) {
    const start = previous[segment]?.[end];
    if (start === undefined) return undefined;
    boundaries.unshift(start);
    end = start;
    segment -= 1;
  }
  // The score scale is estimated once from the whole query curve, so the
  // residual is comparable across candidate partitions. A change point is a
  // fitted discrete location as well as an extra segment mean; charging both
  // parameters prevents a gentle monotonic tail from being misread as a
  // statistically distinct leader.
  return {
    boundaries,
    criterion: residual + (segmentCount * 2 - 1) * Math.log(Math.max(2, count)),
  };
}

function evidenceAtoms(result: AgentToolSearchResult): readonly string[] {
  const atoms = new Set(result.matchedTerms.map((term) => `term:${term}`));
  for (const capability of result.matchedCapabilities) {
    capability.matchedFacets.forEach((facet) => atoms.add(`facet:${facet}`));
  }
  if (result.ranks.structural !== undefined) atoms.add("structure");
  if (result.ranks.semantic !== undefined) atoms.add("semantic");
  if (result.ranks.memory !== undefined) atoms.add("memory");
  return [...atoms];
}

/**
 * Semantic scores are model-relative, so no cosine floor can determine an
 * actionable result. A single candidate becomes a semantic `match` only when
 * the BIC curve isolates it, it owns the semantic leading plateau, and its
 * fused result contains no lexical/fuzzy/structural shortcut. The last rule
 * matters: a generic lexical word may create a score gap, but it is not a
 * semantic proof of an operation.
 */
function isolatedSemanticLeaderNames(evidence: readonly CandidateEvidence[]): ReadonlySet<string> {
  const semanticOnly = evidence.filter(
    (entry) => entry.result.semanticScore !== undefined && hasOnlySemanticEvidence(entry.result),
  );
  const semanticCurve = partitionAgentToolSearchScoreCurve(
    semanticOnly.map((entry) => ({ ...entry, score: entry.result.semanticScore ?? Number.NaN })),
  );
  const leadingBand = semanticCurve.bands[0] ?? [];
  if (semanticCurve.bands.length < 2 || leadingBand.length !== 1) return new Set();

  const semanticRanks = semanticOnly
    .map((entry) => entry.result.ranks.semantic)
    .filter((rank): rank is number => rank !== undefined);
  if (semanticRanks.length === 0) return new Set();

  const leadingRank = Math.min(...semanticRanks);
  const leaders = semanticOnly.filter((entry) => entry.result.ranks.semantic === leadingRank);
  const leader = leadingBand[0];
  if (!leader || leaders.length !== 1 || leaders[0]?.result.toolName !== leader.result.toolName) return new Set();
  return new Set([leader.result.toolName]);
}

function hasOnlySemanticEvidence(result: AgentToolSearchResult): boolean {
  return Object.keys(result.ranks).every((name) => name === "semantic");
}

function orderByMarginalCoverage(
  entries: readonly CandidateEvidence[],
  initialCoverage: ReadonlySet<string> = new Set(),
): CandidateEvidence[] {
  const selected: CandidateEvidence[] = [];
  const remaining = [...entries];
  const covered = new Set(initialCoverage);
  const weights = atomWeights(entries);
  while (remaining.length > 0) {
    const next = remaining
      .map((entry) => ({
        entry,
        gain: entry.atoms.reduce((total, atom) => total + (covered.has(atom) ? 0 : (weights.get(atom) ?? 0)), 0),
      }))
      .sort(
        (left, right) =>
          right.gain - left.gain ||
          right.entry.result.score - left.entry.result.score ||
          left.entry.result.toolName.localeCompare(right.entry.result.toolName),
      )[0];
    if (!next) break;
    selected.push(next.entry);
    next.entry.atoms.forEach((atom) => covered.add(atom));
    remaining.splice(
      remaining.findIndex((entry) => entry.result.toolName === next.entry.result.toolName),
      1,
    );
  }
  return selected;
}

function atomWeights(entries: readonly CandidateEvidence[]): ReadonlyMap<string, number> {
  const frequency = new Map<string, number>();
  entries.forEach((entry) => entry.atoms.forEach((atom) => frequency.set(atom, (frequency.get(atom) ?? 0) + 1)));
  return new Map(
    [...frequency].map(([atom, count]) => [atom, 1 + Math.log((entries.length + 1) / (count + 1))] as const),
  );
}

function isFlat(scores: readonly number[]): boolean {
  if (scores.length < 2) return true;
  const scale = scoreScale(scores);
  return scores.every((score) => Math.abs(score - scores[0]!) <= scale * Number.EPSILON * 16);
}

function scoreScale(scores: readonly number[]): number {
  const center = median(scores);
  const mad = median(scores.map((score) => Math.abs(score - center)));
  // The leading score is exactly what the partitioner is evaluating, so a
  // global RMS estimate would let one outlier inflate its own noise scale and
  // conceal a genuine isolated lead. MAD measures the dense candidate body
  // instead; exact ties remain a zero-noise plateau protected by epsilon.
  return Math.max(1.4826 * mad, Number.EPSILON);
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1 ? (ordered[middle] ?? 0) : ((ordered[middle - 1] ?? 0) + (ordered[middle] ?? 0)) / 2;
}
