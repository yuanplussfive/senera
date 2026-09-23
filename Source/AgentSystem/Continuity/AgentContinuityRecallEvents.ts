import { errorMessage } from "../Core/AgentErrors.js";
import { AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentDomainEvent, AgentEventSink } from "../Events/AgentEventTypes.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { AgentContinuityLearningRecallConfig } from "../Types/AgentToolAndMemoryConfigTypes.js";
import type { AgentContinuitySemanticRecallResult } from "./AgentContinuitySemanticRecall.js";
import type { AgentContinuityRankResult } from "./AgentContinuityRecordRanker.js";
import type { AgentContinuityRecallQueryPlan } from "./AgentContinuityRecallQueryPlan.js";
import { projectAgentContinuityRecallQueryPlanAudit } from "./AgentContinuityRecallQueryPlan.js";
import type { AgentContinuityRecallCascadeStage } from "./AgentContinuityRecallCascade.js";
import { mergeAgentContinuityRankedRecordsByObservationUri } from "./AgentContinuityRecallCascade.js";
import {
  countMatchedBy,
  isSemanticUnavailable,
  type SemanticRecallTimeoutResult,
} from "./AgentContinuityMemoryServiceSupport.js";

export interface AgentContinuityRecallEventInput {
  readonly eventSink?: AgentEventSink;
  readonly logger?: Pick<AgentLogger, "warn">;
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly recallStartedAt: number;
  readonly rankingResult?: AgentContinuityRankResult;
  readonly eventRankingResult?: AgentContinuityRankResult;
  readonly semanticResult: AgentContinuitySemanticRecallResult | SemanticRecallTimeoutResult | undefined;
  readonly recall: AgentContinuityLearningRecallConfig;
  readonly originalQuery: string;
  readonly queryPlan: AgentContinuityRecallQueryPlan | undefined;
  readonly adaptiveStages: readonly AgentContinuityRecallCascadeStage[];
}

/** Emits recall telemetry independently from ranking and prompt projection. */
export function emitAgentContinuityRecallEvents(input: AgentContinuityRecallEventInput): void {
  const sink = input.eventSink;
  if (!sink || !input.sessionId || !input.requestId) return;

  const context = { sessionId: input.sessionId, requestId: input.requestId };
  const degraded =
    input.semanticResult?.status === "timeout"
      ? "semantic_timeout"
      : input.semanticResult && isSemanticUnavailable(input.semanticResult.status)
        ? "semantic_unavailable"
        : "none";
  publish(input, sink, {
    kind: AgentEventKinds.ContinuityRecallQuery,
    context,
    data: {
      original: input.originalQuery,
      ...(input.queryPlan ? { local: projectAgentContinuityRecallQueryPlanAudit(input.queryPlan) } : {}),
    },
  });

  const matchedByCounts = countMatchedBy(input.rankingResult, input.eventRankingResult);
  const allRankedRecords = mergeAgentContinuityRankedRecordsByObservationUri([
    ...(input.rankingResult?.records ?? []),
    ...(input.eventRankingResult?.records ?? []),
  ]);
  const eventRankedRecords = mergeAgentContinuityRankedRecordsByObservationUri(input.eventRankingResult?.records ?? []);
  const nearMissUris = new Set(
    [...(input.rankingResult?.nearMisses ?? []), ...(input.eventRankingResult?.nearMisses ?? [])].map(
      (record) => record.observation.uri,
    ),
  );
  publish(input, sink, {
    kind: AgentEventKinds.ContinuityRecallSettled,
    context,
    data: {
      injectedCount: allRankedRecords.length,
      eventCount: eventRankedRecords.length,
      matchedByCounts,
      directCount: allRankedRecords.filter((record) => record.projection === "direct").length,
      referenceCount: allRankedRecords.filter((record) => record.projection === "reference").length,
      nearMissCount: nearMissUris.size,
      belowSimilarity:
        (input.rankingResult?.rejections.belowSimilarity ?? 0) +
        (input.eventRankingResult?.rejections.belowSimilarity ?? 0),
      belowCandidate:
        (input.rankingResult?.rejections.belowCandidate ?? 0) +
        (input.eventRankingResult?.rejections.belowCandidate ?? 0),
      funnelSkipped:
        (input.rankingResult?.rejections.funnelSkipped ?? 0) +
        (input.eventRankingResult?.rejections.funnelSkipped ?? 0),
      degraded,
      semanticStatus: input.semanticResult?.status ?? (input.recall.Semantic.Enabled ? "unavailable" : "disabled"),
      semanticIndexedCount: input.semanticResult?.indexedCount ?? 0,
      semanticCompatibleCount: input.semanticResult?.compatibleCount ?? 0,
      adaptiveStages: input.adaptiveStages.map((stage) => ({
        source: stage.source,
        triggered: stage.triggered,
        addedTerms: stage.addedTerms,
        acceptedCount: stage.quality.acceptedCount,
        candidateCount: stage.quality.candidateCount,
        topScore: stage.quality.topScore,
        topMargin: stage.quality.topMargin,
      })),
      totalLatencyMs: Date.now() - input.recallStartedAt,
    },
  });
}

function publish(input: AgentContinuityRecallEventInput, sink: AgentEventSink, event: AgentDomainEvent): void {
  const context = event.context as { readonly sessionId?: string; readonly requestId?: string };
  void Promise.resolve(sink(event)).catch((error) => {
    input.logger?.warn("continuity.recall.event_publish_failed", {
      eventKind: event.kind,
      sessionId: context.sessionId,
      requestId: context.requestId,
      message: errorMessage(error),
    });
  });
}
