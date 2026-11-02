import { cosineSim, type Embedding } from "ternlight-mini-cn";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import type { AgentToolTextSegment } from "./AgentToolTextSegmenter.js";

export interface AgentToolTextImportanceWeights {
  readonly queryLexical: number;
  readonly querySemantic: number;
  readonly protectedAtom: number;
  readonly rarity: number;
  readonly boundary: number;
}

export interface AgentToolScoredTextSegment {
  readonly segment: AgentToolTextSegment;
  readonly score: number;
}

export class AgentToolTextImportanceRanker {
  constructor(
    private readonly estimator: { estimate(text: string): { tokenCount: number } },
    private readonly weights: AgentToolTextImportanceWeights,
  ) {}

  rank(
    segments: readonly AgentToolTextSegment[],
    query: string,
    queryVector: Embedding | undefined,
  ): readonly AgentToolScoredTextSegment[] {
    const queryTerms = extractTerms(query);
    const termFrequency = buildTermFrequency(segments);
    const atomCount = segments.reduce((total, segment) => total + segment.atoms.length, 0);
    return segments.map((segment) => ({
      segment,
      score: this.score(segment, segments, queryTerms, queryVector, termFrequency, atomCount),
    }));
  }

  selectWithinBudget(
    scored: readonly AgentToolScoredTextSegment[],
    tokenLimit: number,
    signal?: AbortSignal,
  ): readonly AgentToolScoredTextSegment[] {
    const selected = new Map<number, AgentToolScoredTextSegment>();
    const ordered = [...scored].sort(
      (left, right) => right.score - left.score || left.segment.index - right.segment.index,
    );
    const atoms = [...new Set(scored.flatMap((entry) => entry.segment.atoms))]
      .map((atom) => ({
        atom,
        score: Math.max(...scored.filter((entry) => entry.segment.atoms.includes(atom)).map((entry) => entry.score)),
      }))
      .sort((left, right) => right.score - left.score || left.atom.localeCompare(right.atom));
    for (const { atom } of atoms) {
      throwIfAborted(signal);
      for (const candidate of ordered.filter((entry) => entry.segment.atoms.includes(atom))) {
        if (this.tryAdd(selected, candidate, tokenLimit)) break;
      }
    }
    for (const candidate of ordered) {
      throwIfAborted(signal);
      this.tryAdd(selected, candidate, tokenLimit);
    }
    if (selected.size === 0 && ordered.length > 0) {
      const highestSignal = ordered[0];
      if (highestSignal) selected.set(highestSignal.segment.index, highestSignal);
    }
    return [...selected.values()];
  }

  private score(
    segment: AgentToolTextSegment,
    all: readonly AgentToolTextSegment[],
    queryTerms: readonly string[],
    queryVector: Embedding | undefined,
    termFrequency: ReadonlyMap<string, number>,
    atomCount: number,
  ): number {
    const lexical = overlapScore(segment.terms, queryTerms);
    const semantic = queryVector && segment.vector ? Math.max(0, cosineSim(queryVector, segment.vector)) : 0;
    const protectedScore = Math.min(1, segment.atoms.length / Math.max(1, atomCount));
    const rarity = rarityScore(segment, termFrequency);
    const firstIndex = all[0]?.index;
    const lastIndex = all.at(-1)?.index;
    const boundary = segment.index === firstIndex || segment.index === lastIndex ? 1 : 0.4;
    return (
      lexical * this.weights.queryLexical +
      semantic * this.weights.querySemantic +
      protectedScore * this.weights.protectedAtom +
      rarity * this.weights.rarity +
      boundary * this.weights.boundary +
      (segment.isProtected ? this.weights.protectedAtom * 0.5 : 0)
    );
  }

  private tryAdd(
    selected: Map<number, AgentToolScoredTextSegment>,
    candidate: AgentToolScoredTextSegment,
    tokenLimit: number,
  ): boolean {
    if (selected.has(candidate.segment.index)) return false;
    const text = [...selected.values()]
      .sort((left, right) => left.segment.index - right.segment.index)
      .concat(candidate)
      .sort((left, right) => left.segment.index - right.segment.index)
      .map((entry) => entry.segment.text)
      .join("\n");
    if (this.estimator.estimate(text).tokenCount > tokenLimit) return false;
    selected.set(candidate.segment.index, candidate);
    return true;
  }
}

function extractTerms(value: string): readonly string[] {
  const terms = value.toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
  return [...new Set(terms.filter((term) => term.length > 1))];
}

function overlapScore(left: readonly string[], right: readonly string[]): number {
  if (right.length === 0) return 0;
  const matches = right.filter((term) => left.includes(term)).length;
  return matches / right.length;
}

function rarityScore(segment: AgentToolTextSegment, frequency: ReadonlyMap<string, number>): number {
  if (segment.terms.length === 0) return 0;
  const rare = segment.terms.filter((term) => (frequency.get(term) ?? 0) === 1).length;
  return rare / segment.terms.length;
}

function buildTermFrequency(segments: readonly AgentToolTextSegment[]): ReadonlyMap<string, number> {
  const frequency = new Map<string, number>();
  segments.forEach((segment) => segment.terms.forEach((term) => frequency.set(term, (frequency.get(term) ?? 0) + 1)));
  return frequency;
}
