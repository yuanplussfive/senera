import type { AgentMemorySourceRecord } from "../Memory/AgentMemorySourceRepository.js";
import { AgentContinuityTextSimilarity } from "./AgentContinuityTextSimilarity.js";
import { AgentContinuityRecallRankingDefaults } from "./AgentContinuityRecallDefaults.js";
import type { ResolvedAgentContinuityRecallRankingConfig } from "../Types/AgentToolAndMemoryConfigTypes.js";

const ContinuityWriteEvidenceKind = "continuity_write";

export type AgentContinuityFactLifetime = "session" | "permanent" | string;

export interface AgentContinuityResolvedFactLifetime {
  readonly until: AgentContinuityFactLifetime;
  readonly source?: AgentMemorySourceRecord;
}

interface ContinuityWriteIntent {
  readonly summary: string;
  readonly until: AgentContinuityFactLifetime;
  readonly source: AgentMemorySourceRecord;
}

/** Resolves lifetime from physical MemoryWriteTool evidence, never from model-managed metadata. */
export class AgentContinuityFactLifetimeResolver {
  private readonly similarity: AgentContinuityTextSimilarity;

  constructor(
    private readonly policy: ResolvedAgentContinuityRecallRankingConfig = AgentContinuityRecallRankingDefaults,
  ) {
    this.similarity = new AgentContinuityTextSimilarity(policy.Similarity);
  }

  resolve(fact: string, sources: readonly AgentMemorySourceRecord[]): AgentContinuityResolvedFactLifetime {
    const candidates = sources
      .flatMap(readContinuityWriteIntents)
      .map((intent) => ({
        intent,
        score: Math.max(
          this.similarity.compare(fact, intent.summary).score,
          this.similarity.compare(intent.summary, fact).score,
        ),
      }))
      .filter((candidate) => candidate.score >= this.policy.Evidence.MinimumLifetimeMatchScore)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.intent.source.createdAtMs - right.intent.source.createdAtMs ||
          left.intent.source.uri.localeCompare(right.intent.source.uri),
      );
    const selected = candidates[0]?.intent;
    return selected ? { until: selected.until, source: selected.source } : { until: "permanent" };
  }
}

function readContinuityWriteIntents(source: AgentMemorySourceRecord): ContinuityWriteIntent[] {
  if (source.sourceKind !== "tool_evidence") return [];
  const evidence = objectValue(source.metadata.evidence);
  if (evidence.kind !== ContinuityWriteEvidenceKind) return [];
  const facts = Array.isArray(evidence.facts) ? evidence.facts : [];
  const values = new Map(
    facts.flatMap((fact) => {
      const entry = objectValue(fact);
      return typeof entry.name === "string" && typeof entry.value === "string"
        ? [[entry.name, entry.value] as const]
        : [];
    }),
  );
  const summary = values.get("summary")?.trim();
  const until = parseLifetime(values.get("until"));
  return summary && until ? [{ summary, until, source }] : [];
}

function parseLifetime(value: string | undefined): AgentContinuityFactLifetime | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized === "session" || normalized === "permanent") return normalized;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
