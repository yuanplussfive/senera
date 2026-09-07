import type { AgentEventContext } from "../Events/AgentEventBase.js";
import { type AgentEventKinds } from "../Events/AgentEventCatalog.js";
import type { AgentContinuityRulesSnapshot } from "./AgentContinuityMemoryTypes.js";
import type { AgentContinuityRecallQueryPlanAudit } from "./AgentContinuityRecallQueryPlan.js";
import type { AgentContinuitySemanticRecallStatus } from "./AgentContinuitySemanticRecall.js";

type AgentContinuityRunContext = Required<Pick<AgentEventContext, "sessionId" | "requestId">>;

type AgentContinuitySemanticRecallEventStatus =
  AgentContinuitySemanticRecallStatus | "disabled" | "unavailable" | "timeout";

export type AgentContinuityDomainEvent =
  | {
      kind: typeof AgentEventKinds.ContinuityRulesSnapshot;
      context: AgentContinuityRunContext;
      data: AgentContinuityRulesSnapshot;
    }
  | AgentContinuityRecallEvents;

type AgentContinuityRecallEvents =
  | {
      kind: typeof AgentEventKinds.ContinuityRecallQuery;
      context: AgentContinuityRunContext;
      data: {
        original: string;
        /** Present when deterministic local recall ran for this turn. */
        local?: AgentContinuityRecallQueryPlanAudit;
      };
    }
  | {
      kind: typeof AgentEventKinds.ContinuityRecallSettled;
      context: AgentContinuityRunContext;
      data: {
        injectedCount: number;
        eventCount: number;
        matchedByCounts: {
          textSimilarity: number;
          lexical: number;
          exactPhrase: number;
          exactReference: number;
          embedding: number;
        };
        directCount: number;
        referenceCount: number;
        nearMissCount: number;
        belowSimilarity: number;
        belowCandidate: number;
        funnelSkipped: number;
        degraded: "none" | "semantic_timeout" | "semantic_unavailable";
        semanticStatus: AgentContinuitySemanticRecallEventStatus;
        semanticIndexedCount: number;
        semanticCompatibleCount: number;
        /** Local cascade diagnostics; terms themselves are intentionally omitted. */
        adaptiveStages?: readonly {
          source: "baseline" | "context" | "feedback" | "semantic";
          triggered: boolean;
          addedTerms: number;
          acceptedCount: number;
          candidateCount: number;
          topScore: number;
          topMargin: number;
        }[];
        totalLatencyMs: number;
      };
    };
