import { cosineSim, embedDocument, embedQuery, type Embedding } from "ternlight-mini-cn";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import type { AgentToolTextSegment } from "./AgentToolTextSegmenter.js";

export interface AgentToolTextSemanticEngineOptions {
  readonly cacheEntries: number;
  readonly duplicateThreshold: number;
  readonly maximumUnits: number;
}

export interface AgentToolTextDeduplicationResult {
  readonly segments: readonly AgentToolTextSegment[];
  readonly semanticAvailable: boolean;
}

const embeddingCache = new Map<string, Embedding>();

/** Keeps WASM/model access behind one replaceable boundary. */
export class AgentToolTextSemanticEngine {
  constructor(private readonly options: AgentToolTextSemanticEngineOptions) {}

  embedQuery(query: string, signal?: AbortSignal): Embedding | undefined {
    throwIfAborted(signal);
    return readCachedEmbedding(`q:${query}`, () => embedQuery(query), this.cacheLimit());
  }

  embedDocument(text: string, signal?: AbortSignal): Embedding | undefined {
    throwIfAborted(signal);
    return readCachedEmbedding(`d:${text}`, () => embedDocument(text), this.cacheLimit());
  }

  deduplicate(segments: readonly AgentToolTextSegment[], signal?: AbortSignal): AgentToolTextDeduplicationResult {
    const exactSegments = removeExactDuplicates(segments);
    const maximumUnits = Number.isFinite(this.options.maximumUnits)
      ? Math.max(1, Math.floor(this.options.maximumUnits))
      : 1;
    if (exactSegments.length < 2 || exactSegments.length > maximumUnits) {
      return { segments: exactSegments, semanticAvailable: false };
    }
    const kept: AgentToolTextSegment[] = [];
    let semanticAvailable = true;
    for (const segment of exactSegments) {
      throwIfAborted(signal);
      const vector = this.embedDocument(segment.text, signal);
      if (!vector) {
        semanticAvailable = false;
        kept.push(segment);
        continue;
      }
      segment.vector = vector;
      const duplicate = kept.some(
        (previous) =>
          previous.vector &&
          cosineSim(previous.vector, vector) >= this.options.duplicateThreshold &&
          sameProtectedAtoms(previous.atoms, segment.atoms),
      );
      if (!duplicate) kept.push(segment);
    }
    return {
      segments: semanticAvailable ? kept : exactSegments,
      semanticAvailable,
    };
  }

  private cacheLimit(): number {
    const entries = Number.isFinite(this.options.cacheEntries) ? Math.max(1, Math.floor(this.options.cacheEntries)) : 1;
    const units = Number.isFinite(this.options.maximumUnits) ? Math.max(1, Math.floor(this.options.maximumUnits)) : 1;
    return entries * units;
  }
}

function sameProtectedAtoms(left: readonly string[], right: readonly string[]): boolean {
  if (left.length === 0 && right.length === 0) return true;
  return left.length === right.length && left.every((atom) => right.includes(atom));
}

function removeExactDuplicates(segments: readonly AgentToolTextSegment[]): readonly AgentToolTextSegment[] {
  const seen = new Set<string>();
  return segments.filter((segment) => {
    const key = segment.text.replaceAll(/\s+/gu, " ").trim().toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function readCachedEmbedding(key: string, factory: () => Embedding, limit: number): Embedding | undefined {
  const cached = embeddingCache.get(key);
  if (cached) return cached;
  try {
    const value = factory();
    embeddingCache.set(key, value);
    while (embeddingCache.size > limit) embeddingCache.delete(embeddingCache.keys().next().value as string);
    return value;
  } catch {
    // The semantic engine is an optional accelerator. A lexical projection is
    // still deterministic and loss-aware when WASM cannot initialize.
    return undefined;
  }
}
