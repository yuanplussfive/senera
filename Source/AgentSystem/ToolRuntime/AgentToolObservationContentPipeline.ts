import { mkdirSync } from "node:fs";
import { createSift, type ContentType } from "@agent-context/sift";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import {
  AgentModelTokenEstimator,
  AgentTokenizationPreflight,
  shouldProjectBeforeExactTokenization,
} from "../Text/AgentTextBudget.js";
import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";
import {
  AgentToolAdaptiveTextProjector,
  type AgentToolAdaptiveTextProjectionResult,
} from "./AgentToolAdaptiveTextProjection.js";
import { hasRepeatedAgentToolTextUnits } from "./AgentToolTextSegmenter.js";

export interface AgentToolObservationContentPipelineOptions {
  readonly model: string;
  readonly stashDir: string;
  readonly charactersPerToken?: number;
  readonly chunkOverlapRatio?: number;
}

export interface AgentToolObservationContentProjectionOptions {
  readonly tokenLimit: number;
  readonly query?: string;
  readonly signal?: AbortSignal;
}

export interface AgentToolObservationContentProjectionResult {
  readonly value: unknown;
  readonly complete: boolean;
  readonly changed: boolean;
  readonly omissionCount: number;
  /** Loss introduced by content selection, excluding final structural fitting. */
  readonly contentOmissionCount: number;
  readonly strategy: AgentToolAdaptiveTextProjectionResult["strategy"];
}

type ContentRoute = "structured" | "sift_first" | "split_first";

const StructuredContentTypes = new Set<ContentType>(["json_array", "structured_config", "tabular"]);
const SiftFirstContentTypes = new Set<ContentType>([
  "build_output",
  "search_results",
  "git_diff",
  "source_code",
  "html",
]);

const ContentRoutes = new Map<ContentType, ContentRoute>([
  ...[...StructuredContentTypes].map((type) => [type, "structured"] as const),
  ...[...SiftFirstContentTypes].map((type) => [type, "sift_first"] as const),
]);

const DefaultCharactersPerToken = AgentTokenizationPreflight.maxUtf16CodeUnitsPerToken;
const DefaultChunkOverlapRatio = 0.1;

/**
 * Chooses a content-aware compression path before the shared observation
 * envelope is budgeted. It never owns the final budget: the caller still
 * performs the exact JSON projection after this stage.
 */
export class AgentToolObservationContentPipeline {
  private readonly estimator: AgentModelTokenEstimator;
  private readonly tokenProjector: AgentTokenProjector;
  private readonly adaptiveProjector: AgentToolAdaptiveTextProjector;
  private readonly sift: ReturnType<typeof createSift>;
  private readonly charactersPerToken: number;
  private readonly chunkOverlapRatio: number;

  constructor(options: AgentToolObservationContentPipelineOptions) {
    const stashDir = options.stashDir.trim();
    if (!stashDir) throw new RangeError("Sift stash directory must not be empty.");
    mkdirSync(stashDir, { recursive: true });
    this.estimator = new AgentModelTokenEstimator({ model: options.model });
    this.tokenProjector = new AgentTokenProjector(options.model);
    this.adaptiveProjector = new AgentToolAdaptiveTextProjector(options.model);
    this.sift = createSift({ stashDir });
    this.charactersPerToken = normalizePositive(options.charactersPerToken, DefaultCharactersPerToken);
    this.chunkOverlapRatio = normalizeRatio(options.chunkOverlapRatio, DefaultChunkOverlapRatio);
  }

  async projectValue(
    value: unknown,
    options: AgentToolObservationContentProjectionOptions,
  ): Promise<AgentToolObservationContentProjectionResult> {
    const tokenLimit = normalizePositive(options.tokenLimit, 1);
    // A metadata-rich structured result must be budgeted as one tree. Splitting
    // its leaves into equal text budgets can destroy short coordination values
    // (for example a continuation cursor) before the final JSON projection
    // sees them. The shared JSON projector already walks nested keys, preserves
    // the envelope, and shrinks the largest payloads first. Sift still gets a
    // chance to collapse repetitive text leaves before that structural pass.
    if (isStructuredValue(value)) {
      const query = normalizeQuery(options.query);
      let siftChanged = false;
      let siftLossy = false;
      let adaptiveChanged = false;
      let adaptiveIncomplete = false;
      let adaptiveOmissionCount = 0;
      let adaptiveContentOmissionCount = 0;
      let adaptiveSemantic = false;
      const siftedValue = await mapTextLeaves(value, async (text) => {
        const preflightRequiresProjection = shouldProjectBeforeExactTokenization(text, tokenLimit);
        // Short leaves already fit the current structural budget. Leave them
        // untouched so identifiers and coordination metadata do not incur a
        // semantic pass merely because their parent object is large.
        if (!preflightRequiresProjection && this.estimator.inspect(text, tokenLimit).withinLimit) return text;

        let candidate = text;
        // Avoid scanning an unbounded leaf twice. The adaptive projector has
        // its own bounded segmenter and can still handle this path directly.
        if (!preflightRequiresProjection) {
          const sifted = this.sift.siftText(text, query || undefined);
          siftChanged ||= sifted.changed;
          siftLossy ||= sifted.lossy;
          candidate = sifted.text;
          if (this.estimator.inspect(candidate, tokenLimit).withinLimit) return candidate;
        }

        const bounded = preflightRequiresProjection
          ? this.adaptiveProjector.project(candidate, {
              tokenLimit,
              query: options.query,
              signal: options.signal,
            })
          : await this.projectSplitAndRank(candidate, tokenLimit, options, false, false);
        adaptiveChanged ||= bounded.changed;
        adaptiveIncomplete ||= !bounded.complete;
        adaptiveOmissionCount += bounded.omissionCount;
        adaptiveContentOmissionCount += hasRepeatedAgentToolTextUnits(candidate) ? 0 : bounded.omissionCount;
        adaptiveSemantic ||= bounded.strategy === "semantic";
        return bounded.text;
      });
      const projection = this.tokenProjector.projectJson(siftedValue, tokenLimit);
      return {
        value: projection.projectedValue,
        complete: projection.complete && !siftLossy && !adaptiveIncomplete,
        changed: siftChanged || adaptiveChanged || !projection.complete,
        omissionCount: projection.omissionCount + Number(siftLossy) + adaptiveOmissionCount,
        contentOmissionCount: Number(siftLossy) + adaptiveContentOmissionCount,
        strategy: siftChanged || siftLossy || adaptiveSemantic ? "semantic" : "lexical",
      };
    }
    const leafCount = countTextLeaves(value);
    const fixedTokens = this.tokenProjector.countJson(replaceTextLeavesWithEmpty(value));
    const leafBudget = Math.max(1, Math.floor(Math.max(1, tokenLimit - fixedTokens) / Math.max(1, leafCount)));
    const leafOptions = { ...options, tokenLimit: leafBudget };
    const projections: AgentToolObservationTextProjectionResult[] = [];
    const transformed = await mapTextLeaves(value, async (text) => {
      const projection = await this.projectText(text, leafOptions);
      projections.push(projection);
      return projection.text;
    });
    const result = projections.length > 0 ? projections : [unchangedProjection("")];
    return {
      value: transformed,
      complete: result.every((entry) => entry.complete),
      changed: result.some((entry) => entry.changed),
      omissionCount: result.reduce((total, entry) => total + entry.omissionCount, 0),
      contentOmissionCount: result.reduce((total, entry) => total + entry.omissionCount, 0),
      strategy: result.some((entry) => entry.strategy === "semantic")
        ? "semantic"
        : result.some((entry) => entry.strategy === "lexical")
          ? "lexical"
          : "unchanged",
    };
  }

  private async projectText(
    text: string,
    options: AgentToolObservationContentProjectionOptions,
  ): Promise<AgentToolObservationTextProjectionResult> {
    const tokenLimit = normalizePositive(options.tokenLimit, 1);
    if (this.isWithinBudget(text, tokenLimit)) return unchangedProjection(text);

    const contentType = this.sift.detectContentType(text);
    const route = ContentRoutes.get(contentType) ?? "split_first";
    switch (route) {
      case "structured":
        return this.projectStructured(text, tokenLimit, options, contentType);
      case "sift_first":
        return this.projectSiftFirst(text, tokenLimit, options);
      case "split_first":
        return this.projectSplitFirst(text, tokenLimit, options);
    }
  }

  private projectStructured(
    text: string,
    tokenLimit: number,
    options: AgentToolObservationContentProjectionOptions,
    contentType: ContentType,
  ): AgentToolObservationTextProjectionResult {
    const query = normalizeQuery(options.query);
    const sifted = this.sift.siftText(text, query || undefined);
    if (contentType !== "json_array" && sifted.changed) {
      if (this.isWithinBudget(sifted.text, tokenLimit)) {
        return {
          text: sifted.text,
          complete: !sifted.lossy,
          changed: true,
          omissionCount: sifted.lossy ? 1 : 0,
          strategy: "semantic",
        };
      }
      const refined = this.adaptiveProjector.project(sifted.text, {
        tokenLimit,
        query: options.query,
        signal: options.signal,
      });
      return {
        text: refined.text,
        complete: refined.complete && !sifted.lossy,
        changed: refined.text !== text,
        omissionCount: refined.omissionCount + Number(sifted.lossy),
        strategy: refined.strategy,
      };
    }
    const compactText = sifted.lossy ? text : sifted.text;
    const parsed = parseJson(compactText);
    if (parsed !== undefined) {
      const projection = this.tokenProjector.projectJson(parsed, tokenLimit);
      const projectedText = JSON.stringify(projection.projectedValue);
      return {
        text: projectedText,
        complete: projection.complete,
        changed: projectedText !== text,
        omissionCount: projection.omissionCount,
        strategy: "lexical",
      };
    }
    if (!sifted.lossy && sifted.changed) {
      const rows = compactText.split(/\r?\n/u).filter((row) => row.trim().length > 0);
      const ranked = this.adaptiveProjector.projectUnits(rows, {
        tokenLimit,
        query: options.query,
        signal: options.signal,
      });
      return {
        text: ranked.text,
        complete: ranked.complete,
        changed: ranked.text !== text,
        omissionCount: ranked.omissionCount,
        strategy: ranked.strategy,
      };
    }
    if (!sifted.changed) return incompleteProjection(text);
    return {
      text: compactText,
      complete: this.isWithinBudget(compactText, tokenLimit),
      changed: compactText !== text,
      omissionCount: sifted.lossy ? 1 : 0,
      strategy: "lexical",
    };
  }

  private async projectSiftFirst(
    text: string,
    tokenLimit: number,
    options: AgentToolObservationContentProjectionOptions,
  ): Promise<AgentToolObservationTextProjectionResult> {
    const query = normalizeQuery(options.query);
    const sifted = this.sift.siftText(text, query || undefined);
    if (this.isWithinBudget(sifted.text, tokenLimit)) {
      return {
        text: sifted.text,
        complete: !sifted.lossy,
        changed: sifted.text !== text,
        omissionCount: sifted.lossy ? 1 : 0,
        strategy: "semantic",
      };
    }
    return this.projectSplitAndRank(sifted.text, tokenLimit, options, sifted.text !== text, sifted.lossy);
  }

  private async projectSplitFirst(
    text: string,
    tokenLimit: number,
    options: AgentToolObservationContentProjectionOptions,
  ): Promise<AgentToolObservationTextProjectionResult> {
    const ranked = await this.projectSplitAndRank(text, tokenLimit, options, false, false);
    if (this.isWithinBudget(ranked.text, tokenLimit)) return ranked;
    const query = normalizeQuery(options.query);
    const sifted = this.sift.siftText(ranked.text, query || undefined);
    if (this.isWithinBudget(sifted.text, tokenLimit)) {
      return {
        text: sifted.text,
        complete: !sifted.lossy,
        changed: sifted.text !== text,
        omissionCount: ranked.omissionCount + (sifted.lossy ? 1 : 0),
        strategy: "semantic",
      };
    }
    const final = this.adaptiveProjector.project(sifted.text, {
      tokenLimit,
      query: options.query,
      signal: options.signal,
    });
    return {
      text: final.text,
      complete: final.complete && !sifted.lossy,
      changed: final.text !== text,
      omissionCount: final.omissionCount + ranked.omissionCount + (sifted.lossy ? 1 : 0),
      strategy: final.strategy,
    };
  }

  private async projectSplitAndRank(
    text: string,
    tokenLimit: number,
    options: AgentToolObservationContentProjectionOptions,
    changedBeforeSplit: boolean,
    lossyBeforeSplit: boolean,
  ): Promise<AgentToolObservationTextProjectionResult> {
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: Math.max(1, Math.floor(tokenLimit * this.charactersPerToken)),
      chunkOverlap: Math.max(0, Math.floor(tokenLimit * this.charactersPerToken * this.chunkOverlapRatio)),
      separators: ["\n\n", "\n", ". ", "。", " ", ""],
    });
    const chunks = await splitter.splitText(text);
    const ranked = this.adaptiveProjector.projectUnits(chunks, {
      tokenLimit,
      query: options.query,
      signal: options.signal,
    });
    // LangChain preserves structural chunk boundaries, while the existing
    // projector also knows how to collapse repeated complete lines. Run that
    // second pass only when the chunk-level result still needs pressure work.
    const refined = this.adaptiveProjector.project(ranked.text, {
      tokenLimit,
      query: options.query,
      signal: options.signal,
    });
    const selected = refined.changed || this.isWithinBudget(refined.text, tokenLimit) ? refined : ranked;
    return {
      text: selected.text,
      complete: selected.complete && !lossyBeforeSplit,
      changed: changedBeforeSplit || selected.text !== text,
      omissionCount: selected.omissionCount + Number(lossyBeforeSplit),
      strategy: selected.strategy,
    };
  }

  private isWithinBudget(text: string, tokenLimit: number): boolean {
    if (shouldProjectBeforeExactTokenization(text, tokenLimit)) return false;
    return this.estimator.inspect(text, tokenLimit).withinLimit;
  }
}

interface AgentToolObservationTextProjectionResult {
  readonly text: string;
  readonly complete: boolean;
  readonly changed: boolean;
  readonly omissionCount: number;
  readonly strategy: AgentToolAdaptiveTextProjectionResult["strategy"];
}

async function mapTextLeaves(
  value: unknown,
  transform: (text: string) => Promise<string>,
  ancestors = new WeakSet<object>(),
): Promise<unknown> {
  if (typeof value === "string") return transform(value);
  if (value === null || typeof value !== "object") return value;
  if (ancestors.has(value)) return value;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return Promise.all(value.map((entry) => mapTextLeaves(entry, transform, ancestors)));
    const entries = await Promise.all(
      Object.entries(value).map(
        async ([key, entry]) => [key, await mapTextLeaves(entry, transform, ancestors)] as const,
      ),
    );
    return Object.fromEntries(entries);
  } finally {
    ancestors.delete(value);
  }
}

function countTextLeaves(value: unknown, ancestors = new WeakSet<object>()): number {
  if (typeof value === "string" || typeof value === "bigint") return 1;
  if (value === null || typeof value !== "object" || ancestors.has(value)) return 0;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.reduce((total, entry) => total + countTextLeaves(entry, ancestors), 0);
    return Object.values(value).reduce((total, entry) => total + countTextLeaves(entry, ancestors), 0);
  } finally {
    ancestors.delete(value);
  }
}

function replaceTextLeavesWithEmpty(value: unknown, ancestors = new WeakSet<object>()): unknown {
  if (typeof value === "string" || typeof value === "bigint") return "";
  if (value === null || typeof value !== "object" || ancestors.has(value)) return value;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((entry) => replaceTextLeavesWithEmpty(entry, ancestors));
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, replaceTextLeavesWithEmpty(entry, ancestors)]),
    );
  } finally {
    ancestors.delete(value);
  }
}

function parseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function unchangedProjection(text: string): AgentToolObservationTextProjectionResult {
  return { text, complete: true, changed: false, omissionCount: 0, strategy: "unchanged" };
}

function incompleteProjection(text: string): AgentToolObservationTextProjectionResult {
  return { text, complete: false, changed: false, omissionCount: 1, strategy: "lexical" };
}

function normalizePositive(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value as number)) : fallback;
}

function normalizeRatio(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(0.5, value as number)) : fallback;
}

function normalizeQuery(value: string | undefined): string {
  return value?.replaceAll(/\s+/gu, " ").trim() ?? "";
}

function isStructuredValue(value: unknown): value is Record<string, unknown> | readonly unknown[] {
  return value !== null && typeof value === "object";
}
