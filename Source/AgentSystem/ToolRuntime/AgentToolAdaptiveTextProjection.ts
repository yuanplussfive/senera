import { throwIfAborted } from "../Core/AgentCancellation.js";
import { AgentModelTokenEstimator, shouldProjectBeforeExactTokenization } from "../Text/AgentTextBudget.js";
import type { AgentToolContentPolicyPreservable } from "../Types/AgentToolContentPolicyTypes.js";
import {
  createAgentToolTextCacheKey,
  createAgentToolTextSegmentation,
  extractAgentToolProtectedAtoms,
  hasRepeatedAgentToolTextUnits,
  type AgentToolTextSegment,
} from "./AgentToolTextSegmenter.js";
import { AgentToolTextImportanceRanker, type AgentToolTextImportanceWeights } from "./AgentToolTextImportanceRanker.js";
import { AgentToolTextSemanticEngine } from "./AgentToolTextSemanticEngine.js";

/**
 * The adaptive projector is deliberately extractive. It can remove repeated
 * or low-signal complete units, but it never invents text and never mutates
 * the Artifact payload. The compiler still performs the final JSON budget
 * projection after this stage.
 */
export interface AgentToolAdaptiveTextProjectionOptions {
  readonly tokenLimit: number;
  readonly query?: string;
  readonly preserve?: readonly AgentToolContentPolicyPreservable[];
  readonly signal?: AbortSignal;
}

export interface AgentToolAdaptiveTextProjectionResult {
  readonly text: string;
  readonly complete: boolean;
  readonly changed: boolean;
  readonly omissionCount: number;
  readonly sourceUnits: number;
  readonly projectedUnits: number;
  readonly protectedAtoms: readonly string[];
  readonly strategy: "unchanged" | "lexical" | "semantic";
}

export interface AgentToolAdaptiveValueProjectionResult {
  readonly value: unknown;
  readonly complete: boolean;
  readonly changed: boolean;
  readonly omissionCount: number;
  readonly strategy: "unchanged" | "lexical" | "semantic";
}

export interface AgentToolAdaptiveTextProjectionDefaults {
  readonly minimumCharacters: number;
  readonly maximumUnits: number;
  readonly semanticDuplicateThreshold: number;
  readonly maximumSemanticUnits: number;
  readonly cacheEntries: number;
  readonly cacheCharacters: number;
  readonly queryLexicalWeight: number;
  readonly querySemanticWeight: number;
  readonly protectedAtomWeight: number;
  readonly rarityWeight: number;
  readonly boundaryWeight: number;
}

export const AgentToolAdaptiveProjectionDefaults = Object.freeze({
  minimumCharacters: 8_192,
  maximumUnits: 256,
  semanticDuplicateThreshold: 0.92,
  maximumSemanticUnits: 256,
  cacheEntries: 32,
  cacheCharacters: 4_000_000,
  queryLexicalWeight: 0.3,
  querySemanticWeight: 0.28,
  protectedAtomWeight: 0.24,
  rarityWeight: 0.1,
  boundaryWeight: 0.08,
});

interface CachedSegments {
  readonly segments: readonly AgentToolTextSegment[];
  readonly sourceUnits: number;
  readonly omittedUnits: number;
  readonly characters: number;
}

const segmentCache = new Map<string, CachedSegments>();
let segmentCacheCharacters = 0;

export class AgentToolAdaptiveTextProjector {
  private readonly estimator: AgentModelTokenEstimator;
  private readonly semanticEngine: AgentToolTextSemanticEngine;
  private readonly ranker: AgentToolTextImportanceRanker;

  constructor(
    model: string,
    private readonly defaults: AgentToolAdaptiveTextProjectionDefaults = AgentToolAdaptiveProjectionDefaults,
  ) {
    this.estimator = new AgentModelTokenEstimator({ model });
    this.semanticEngine = new AgentToolTextSemanticEngine({
      cacheEntries: defaults.cacheEntries,
      duplicateThreshold: defaults.semanticDuplicateThreshold,
      maximumUnits: defaults.maximumSemanticUnits,
    });
    const weights: AgentToolTextImportanceWeights = {
      queryLexical: defaults.queryLexicalWeight,
      querySemantic: defaults.querySemanticWeight,
      protectedAtom: defaults.protectedAtomWeight,
      rarity: defaults.rarityWeight,
      boundary: defaults.boundaryWeight,
    };
    this.ranker = new AgentToolTextImportanceRanker(this.estimator, weights);
  }

  project(text: string, options: AgentToolAdaptiveTextProjectionOptions): AgentToolAdaptiveTextProjectionResult {
    throwIfAborted(options.signal);
    const tokenLimit = normalizeTokenLimit(options.tokenLimit);
    const repeatedUnits = hasRepeatedAgentToolTextUnits(text, options.preserve);
    if (!shouldConsiderAdaptiveProjection(text, tokenLimit, this.defaults.minimumCharacters) && !repeatedUnits) {
      return unchangedTextProjection(text, 0, "unchanged");
    }

    const originalTokenCount = shouldProjectBeforeExactTokenization(text, tokenLimit)
      ? tokenLimit + 1
      : this.estimator.estimate(text).tokenCount;
    if (originalTokenCount <= tokenLimit && !repeatedUnits) {
      return unchangedTextProjection(text, 0, "unchanged");
    }

    const cached = this.readSegments(text, options);
    const deduplication = this.semanticEngine.deduplicate(cached.segments, options.signal);
    const query = normalizeQuery(options.query);
    const queryVector = query ? this.semanticEngine.embedQuery(query, options.signal) : undefined;
    const scored = this.ranker.rank(deduplication.segments, query, queryVector);
    const selected = this.ranker.selectWithinBudget(scored, tokenLimit, options.signal);
    const output = selected.map((entry) => entry.segment).sort((left, right) => left.index - right.index);
    const projectedText = output.map((entry) => entry.text).join("\n");
    const changed = projectedText !== text;
    const omitted = Math.max(cached.omittedUnits, cached.sourceUnits - output.length);
    const strategy =
      queryVector || (deduplication.semanticAvailable && deduplication.segments.length !== cached.segments.length)
        ? "semantic"
        : "lexical";
    return {
      text: projectedText,
      complete: !changed && omitted === 0,
      changed,
      omissionCount: omitted,
      sourceUnits: cached.sourceUnits,
      projectedUnits: output.length,
      protectedAtoms: [...new Set(output.flatMap((segment) => segment.atoms))],
      strategy,
    };
  }

  projectTargets(
    value: unknown,
    targets: readonly string[] | undefined,
    options: AgentToolAdaptiveTextProjectionOptions,
  ): AgentToolAdaptiveValueProjectionResult {
    const projections: AgentToolAdaptiveTextProjectionResult[] = [];
    const pointers = targets?.length ? targets : [""];
    const transformed = pointers.reduce(
      (current, pointer, index) =>
        replaceTarget(current, pointer, (text) => {
          const targetLimit = Math.max(1, Math.floor(options.tokenLimit / (pointers.length - index)));
          const projection = this.project(text, { ...options, tokenLimit: targetLimit });
          projections.push(projection);
          return projection;
        }),
      value,
    );
    const results = projections.length > 0 ? projections : [unchangedTextProjection("", 0, "unchanged")];
    return {
      value: transformed,
      complete: results.every((entry) => entry.complete),
      changed: results.some((entry) => entry.changed),
      omissionCount: results.reduce((total, entry) => total + entry.omissionCount, 0),
      strategy: results.some((entry) => entry.strategy === "semantic")
        ? "semantic"
        : results.some((entry) => entry.strategy === "lexical")
          ? "lexical"
          : "unchanged",
    };
  }

  private readSegments(text: string, options: AgentToolAdaptiveTextProjectionOptions): CachedSegments {
    const key = createAgentToolTextCacheKey(text, options.preserve, this.defaults.maximumUnits);
    const cached = segmentCache.get(key);
    if (cached) return cached;
    const segmentation = createAgentToolTextSegmentation(
      text,
      options.preserve,
      this.estimator,
      this.defaults.maximumUnits,
    );
    const cachedSegments: CachedSegments = {
      ...segmentation,
      characters: segmentation.segments.reduce((total, segment) => total + segment.text.length, 0),
    };
    rememberSegments(key, cachedSegments, this.defaults.cacheEntries, this.defaults.cacheCharacters);
    return cachedSegments;
  }
}

function shouldConsiderAdaptiveProjection(text: string, tokenLimit: number, minimumCharacters: number): boolean {
  return text.length >= minimumCharacters || text.length >= tokenLimit * 4;
}

function unchangedTextProjection(
  text: string,
  sourceUnits: number,
  strategy: AgentToolAdaptiveTextProjectionResult["strategy"],
): AgentToolAdaptiveTextProjectionResult {
  return {
    text,
    complete: true,
    changed: false,
    omissionCount: 0,
    sourceUnits,
    projectedUnits: sourceUnits,
    protectedAtoms: extractAgentToolProtectedAtoms(text),
    strategy,
  };
}

function replaceTarget(
  value: unknown,
  pointer: string,
  transform: (text: string) => AgentToolAdaptiveTextProjectionResult,
): unknown {
  if (pointer === "") return mapTextLeaves(value, transform);
  if (!isContainer(value)) return value;
  const segments = pointer.slice(1).split("/").map(unescapePointer);
  return replaceTargetSegments(value, segments, transform);
}

function replaceTargetSegments(
  value: Record<string, unknown> | readonly unknown[],
  segments: readonly string[],
  transform: (text: string) => AgentToolAdaptiveTextProjectionResult,
): unknown {
  const [head, ...tail] = segments;
  if (head === undefined) return value;
  if (Array.isArray(value)) {
    if (!/^(?:0|[1-9]\d*)$/u.test(head)) return value;
    const index = Number(head);
    if (index >= value.length) return value;
    const next =
      tail.length === 0
        ? mapTextLeaves(value[index], transform)
        : isContainer(value[index])
          ? replaceTargetSegments(value[index], tail, transform)
          : value[index];
    if (next === value[index]) return value;
    const copy = [...value];
    copy[index] = next;
    return copy;
  }
  const record = value as Record<string, unknown>;
  if (!Object.hasOwn(record, head)) return value;
  const next =
    tail.length === 0
      ? mapTextLeaves(record[head], transform)
      : isContainer(record[head])
        ? replaceTargetSegments(record[head], tail, transform)
        : record[head];
  if (next === record[head]) return value;
  return { ...record, [head]: next };
}

function mapTextLeaves(value: unknown, transform: (text: string) => AgentToolAdaptiveTextProjectionResult): unknown {
  if (typeof value === "string") return transform(value).text;
  if (Array.isArray(value)) return value.map((entry) => mapTextLeaves(entry, transform));
  if (isContainer(value))
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, mapTextLeaves(entry, transform)]));
  return value;
}

function isContainer(value: unknown): value is Record<string, unknown> | readonly unknown[] {
  return typeof value === "object" && value !== null;
}

function unescapePointer(value: string): string {
  return value.replaceAll("~1", "/").replaceAll("~0", "~");
}

function normalizeTokenLimit(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

function normalizeQuery(value: string | undefined): string {
  return value?.replaceAll(/\s+/gu, " ").trim() ?? "";
}

function rememberSegments(key: string, value: CachedSegments, entryLimit: number, characterLimit: number): void {
  const previous = segmentCache.get(key);
  if (previous) segmentCacheCharacters -= previous.characters;
  segmentCache.delete(key);
  segmentCache.set(key, value);
  segmentCacheCharacters += value.characters;
  while (segmentCache.size > Math.max(1, entryLimit) || segmentCacheCharacters > Math.max(1, characterLimit)) {
    const oldestKey = segmentCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldest = segmentCache.get(oldestKey);
    segmentCache.delete(oldestKey);
    segmentCacheCharacters -= oldest?.characters ?? 0;
  }
}
