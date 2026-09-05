import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import type { AgentContinuityLearningRecallConfig } from "../Types/AgentToolAndMemoryConfigTypes.js";
import { AgentContinuitySemanticRecallStatuses } from "./AgentContinuitySemanticRecall.js";
import type { AgentResidentProfilePromptEntry } from "../Profile/AgentResidentProfileTypes.js";
import type {
  AgentContinuityObservation,
  AgentContinuityRule,
  AgentContinuityRuleEvaluation,
  AgentContinuitySignal,
} from "./AgentContinuityDomain.js";
import type { AgentContinuityPromptSignal, AgentContinuityRulesSnapshot } from "./AgentContinuityMemoryTypes.js";
import {
  AgentContinuitySemanticStateNamespace,
  createAgentContinuityStateIdentity,
} from "./AgentContinuityStateIdentity.js";
import {
  AgentContinuityPromptBudgetDefaults,
  AgentContinuityRecallRankingDefaults,
  AgentContinuitySemanticRecallDefaults,
} from "./AgentContinuityRecallDefaults.js";
import type {
  AgentContinuityRankedRecord,
  AgentContinuityRankRejections,
  AgentContinuityRankResult,
} from "./AgentContinuityRecordRanker.js";

export interface AgentContinuityEvaluatedState {
  readonly signals: readonly AgentContinuitySignal[];
  readonly evaluatedRules: readonly {
    readonly rule: AgentContinuityRule;
    readonly evaluation: AgentContinuityRuleEvaluation;
    readonly shouldProject: boolean;
  }[];
}

export type SemanticRecallTimeoutResult = {
  readonly status: "timeout";
  readonly scores: ReadonlyMap<string, number>;
  readonly indexedCount: number;
  readonly compatibleCount: number;
};

export const DisabledContinuityRecallConfig: AgentContinuityLearningRecallConfig = {
  TurnValueClassifier: {
    Enabled: false,
    ConfidenceThreshold: 1,
    MinimumExamplesPerLabel: 1,
    MaxTrainingEntries: 0,
  },
  Prefetch: { Enabled: false, CacheTtlSeconds: 0 },
  PromptBudget: AgentContinuityPromptBudgetDefaults,
  Ranking: AgentContinuityRecallRankingDefaults,
  Semantic: AgentContinuitySemanticRecallDefaults,
};

export function stablePromptRevision(residentProfile: readonly AgentResidentProfilePromptEntry[]): string {
  return sha256HexOfCanonicalJson({ residentProfile });
}

export function projectRuleCatalog(
  evaluatedRules: AgentContinuityEvaluatedState["evaluatedRules"],
): AgentContinuityRulesSnapshot["rules"] {
  return evaluatedRules.map(({ rule, evaluation }) => ({
    uri: rule.uri,
    title: rule.title,
    action: rule.action.summary,
    actionKind: rule.action.kind,
    activation: rule.action.activation,
    status: evaluation.status,
    truth: evaluation.truth,
    score: evaluation.score,
    threshold: evaluation.threshold,
    missingSignals: evaluation.missingSignals,
    conditions: evaluation.conditions,
    authority: rule.authority,
    confidence: rule.confidence,
    supportCount: rule.supportCount ?? rule.sourceRefs.length,
    maturity: rule.maturity ?? "active",
    ...(rule.temporal.endsAt ? { validUntil: rule.temporal.endsAt } : {}),
    ...(rule.lastEvaluatedAt ? { lastEvaluatedAt: rule.lastEvaluatedAt } : {}),
    ...(rule.lastTriggeredAt ? { lastTriggeredAt: rule.lastTriggeredAt } : {}),
  }));
}

export function projectSignal(signal: AgentContinuitySignal): AgentContinuityPromptSignal {
  const identity = createAgentContinuityStateIdentity({
    namespace: signal.namespace,
    key: signal.key,
    summary:
      signal.namespace === AgentContinuitySemanticStateNamespace ? signal.key : `${signal.namespace}.${signal.key}`,
    scope: signal.scope,
  });
  return {
    uri: identity.uri,
    summary: identity.summary,
    valueJson: JSON.stringify(signal.value),
    valueType: signal.valueType,
    observedAt: signal.observedAt,
    expiresAt: signal.expiresAt ?? "",
  };
}

export function combineRejections(
  ...sources: (AgentContinuityRankRejections | undefined)[]
): AgentContinuityRankRejections {
  const total: { -readonly [key in keyof AgentContinuityRankRejections]: number } = {
    belowSimilarity: 0,
    belowCandidate: 0,
    funnelSkipped: 0,
  };
  for (const source of sources) {
    if (!source) continue;
    total.belowSimilarity += source.belowSimilarity;
    total.belowCandidate += source.belowCandidate;
    total.funnelSkipped += source.funnelSkipped;
  }
  return total;
}

export function uniqueRankedRecords(records: readonly AgentContinuityRankedRecord[]): AgentContinuityRankedRecord[] {
  const unique = new Map<string, AgentContinuityRankedRecord>();
  for (const record of records) {
    const key = continuityRecordIdentity(record.observation);
    if (!unique.has(key)) unique.set(key, record);
  }
  return [...unique.values()];
}

function continuityRecordIdentity(observation: AgentContinuityObservation): string {
  const factKey = readStringPayload(observation.payload, "factKey");
  return [observation.scope.kind, observation.scope.id, factKey ?? observation.uri].join("\u0000");
}

function readStringPayload(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

export function countMatchedBy(
  ranking: AgentContinuityRankResult | undefined,
  eventRanking: AgentContinuityRankResult | undefined,
): { textSimilarity: number; lexical: number; exactPhrase: number; exactReference: number; embedding: number } {
  const counts = { textSimilarity: 0, lexical: 0, exactPhrase: 0, exactReference: 0, embedding: 0 };
  const records = new Map<string, AgentContinuityRankedRecord>();
  for (const record of [...(ranking?.records ?? []), ...(eventRanking?.records ?? [])]) {
    const previous = records.get(record.observation.uri);
    records.set(record.observation.uri, previous ? mergeMatchedEvidence(previous, record) : record);
  }
  for (const record of records.values()) {
    for (const method of record.matchedBy) {
      if (method === "text_similarity") counts.textSimilarity += 1;
      else if (method === "lexical") counts.lexical += 1;
      else if (method === "exact_phrase") counts.exactPhrase += 1;
      else if (method === "exact_ref") counts.exactReference += 1;
      else if (method === "embedding") counts.embedding += 1;
    }
  }
  return counts;
}

function mergeMatchedEvidence(
  left: AgentContinuityRankedRecord,
  right: AgentContinuityRankedRecord,
): AgentContinuityRankedRecord {
  return {
    ...(left.score >= right.score ? left : right),
    score: Math.max(left.score, right.score),
    textSimilarityScore: Math.max(left.textSimilarityScore, right.textSimilarityScore),
    lexicalScore: Math.max(left.lexicalScore, right.lexicalScore),
    semanticScore: Math.max(left.semanticScore, right.semanticScore),
    matchedBy: [...new Set([...left.matchedBy, ...right.matchedBy])],
    projection: left.projection === "direct" || right.projection === "direct" ? "direct" : "reference",
  };
}

export function semanticRecallTimeoutResult(): SemanticRecallTimeoutResult {
  return { status: "timeout", scores: new Map(), indexedCount: 0, compatibleCount: 0 };
}

export function isSemanticUnavailable(status: string): boolean {
  return new Set<string>([
    AgentContinuitySemanticRecallStatuses.NoClient,
    AgentContinuitySemanticRecallStatuses.NoEmbeddings,
    AgentContinuitySemanticRecallStatuses.ModelMismatch,
    AgentContinuitySemanticRecallStatuses.NoVector,
    AgentContinuitySemanticRecallStatuses.DimensionMismatch,
    AgentContinuitySemanticRecallStatuses.RequestFailed,
  ]).has(status);
}

export class AgentContinuitySemanticTimeoutError extends Error {
  readonly code = "CONTINUITY_SEMANTIC_TIMEOUT" as const;

  constructor() {
    super("Continuity semantic recall timed out.");
    this.name = "AgentContinuitySemanticTimeoutError";
  }
}

export function isAgentContinuitySemanticTimeoutError(error: unknown): error is AgentContinuitySemanticTimeoutError {
  return (
    error instanceof AgentContinuitySemanticTimeoutError ||
    (error instanceof Error && (error as Error & { readonly code?: unknown }).code === "CONTINUITY_SEMANTIC_TIMEOUT")
  );
}

export function withTimeout<T>(work: Promise<T>, timeoutMs: number, onTimeout?: () => void): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => {
        onTimeout?.();
        reject(new AgentContinuitySemanticTimeoutError());
      },
      Math.max(1, timeoutMs),
    );
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
