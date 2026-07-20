import {
  estimateContextTokens,
  estimateTokens,
  prepareCompaction,
  type AgentMessage,
  type CompactionPreparation,
  type CompactionSettings,
  type SessionTreeEntry,
} from "@earendil-works/pi-agent-core";
import type { ResolvedAgentModelProviderConfig, ResolvedAgentPiCompactionConfig } from "../Types/AgentConfigTypes.js";
import { resolveAgentPiOpenAiPlanningProjectionLimits } from "../PiProxy/AgentPiOpenAiPlanningProjector.js";

export const AgentPiCompactionDispositions = {
  Skip: "skip",
  Compact: "compact",
  ReduceContextOverhead: "reduce_context_overhead",
} as const;

export type AgentPiCompactionDisposition =
  (typeof AgentPiCompactionDispositions)[keyof typeof AgentPiCompactionDispositions];

export const AgentPiCompactionSkipReasons = {
  Disabled: "disabled",
  AlreadyCompacted: "already_compacted",
  BelowThreshold: "below_threshold",
  FixedOverheadDominant: "fixed_overhead_dominant",
  NoCompactableHistory: "no_compactable_history",
} as const;

export type AgentPiCompactionSkipReason =
  (typeof AgentPiCompactionSkipReasons)[keyof typeof AgentPiCompactionSkipReasons];

export type AgentPiCompactionPressureReason =
  "reported_token_threshold" | "history_token_threshold" | "message_threshold";

export interface AgentPiCompactionInspection {
  shouldCompact: boolean;
  disposition: AgentPiCompactionDisposition;
  skipReason?: AgentPiCompactionSkipReason;
  pressureReasons: AgentPiCompactionPressureReason[];
  reportedContextTokens: number;
  branchHistoryTokens: number;
  fixedOverheadTokens: number;
  messageCount: number;
  compactableMessageCount: number;
  turnPrefixMessageCount: number;
  compactableHistoryTokens: number;
  effectiveTokenBudget: number;
  effectiveMessageBudget: number;
  triggerTokens: number;
  triggerMessages: number;
  requestHardLimitExceeded: boolean;
  hardLimitExceeded: boolean;
  targetTokens: number;
  targetMessages: number;
  settings: CompactionSettings;
}

export type AgentPiCompactionPlan =
  | {
      kind: typeof AgentPiCompactionDispositions.Skip;
      reason: Exclude<AgentPiCompactionSkipReason, "fixed_overhead_dominant">;
      inspection: AgentPiCompactionInspection;
    }
  | {
      kind: typeof AgentPiCompactionDispositions.ReduceContextOverhead;
      reason: typeof AgentPiCompactionSkipReasons.FixedOverheadDominant;
      inspection: AgentPiCompactionInspection;
    }
  | {
      kind: typeof AgentPiCompactionDispositions.Compact;
      inspection: AgentPiCompactionInspection;
      preparation: CompactionPreparation;
      leafEntryId: string;
    };

export type AgentPiCompactionRunResult =
  | {
      status: "skipped";
      reason: AgentPiCompactionSkipReason;
      inspection: AgentPiCompactionInspection;
    }
  | {
      status: "compacted";
      inspection: AgentPiCompactionInspection;
      summary: string;
      firstKeptEntryId: string;
      tokensBefore: number;
    }
  | { status: "failed"; inspection: AgentPiCompactionInspection; error: string };

interface AgentPiCompactionMetrics {
  pressureReasons: AgentPiCompactionPressureReason[];
  reportedContextTokens: number;
  branchHistoryTokens: number;
  fixedOverheadTokens: number;
  messageCount: number;
  effectiveTokenBudget: number;
  effectiveMessageBudget: number;
  triggerTokens: number;
  triggerMessages: number;
  requestHardLimitExceeded: boolean;
  hardLimitExceeded: boolean;
  targetTokens: number;
  targetMessages: number;
  settings: CompactionSettings;
}

export class AgentPiCompactionPolicy {
  constructor(
    private readonly config: ResolvedAgentPiCompactionConfig,
    private readonly provider: Pick<ResolvedAgentModelProviderConfig, "ContextWindowTokens" | "MaxOutputTokens">,
  ) {}

  get timeoutMs(): number {
    return this.config.TimeoutMs;
  }

  plan(messages: readonly AgentMessage[], branchEntries: readonly SessionTreeEntry[]): AgentPiCompactionPlan {
    const metrics = this.measure(messages);
    const latestEntry = branchEntries.at(-1);
    if (!this.config.Enabled) {
      return this.skip(metrics, AgentPiCompactionSkipReasons.Disabled);
    }
    if (latestEntry?.type === "compaction") {
      return this.skip(metrics, AgentPiCompactionSkipReasons.AlreadyCompacted);
    }

    const historyPressure = metrics.pressureReasons.some(
      (reason) => reason === "history_token_threshold" || reason === "message_threshold",
    );
    const reportedPressure = metrics.pressureReasons.includes("reported_token_threshold");
    if (!historyPressure) {
      return reportedPressure
        ? this.reduceContextOverhead(metrics)
        : this.skip(metrics, AgentPiCompactionSkipReasons.BelowThreshold);
    }

    const prepared = prepareCompaction([...branchEntries], metrics.settings);
    if (!prepared.ok) throw prepared.error;
    const preparation = prepared.value;
    if (!preparation) {
      return this.skip(metrics, AgentPiCompactionSkipReasons.NoCompactableHistory);
    }

    const compactableMessages = [...preparation.messagesToSummarize, ...preparation.turnPrefixMessages];
    if (compactableMessages.length === 0) {
      return this.skip(metrics, AgentPiCompactionSkipReasons.NoCompactableHistory);
    }

    const leafEntryId = latestEntry?.id;
    if (!leafEntryId) {
      return this.skip(metrics, AgentPiCompactionSkipReasons.NoCompactableHistory);
    }

    return {
      kind: AgentPiCompactionDispositions.Compact,
      preparation,
      leafEntryId,
      inspection: this.inspection(metrics, {
        disposition: AgentPiCompactionDispositions.Compact,
        compactableMessages: preparation.messagesToSummarize,
        turnPrefixMessages: preparation.turnPrefixMessages,
      }),
    };
  }

  private measure(messages: readonly AgentMessage[]): AgentPiCompactionMetrics {
    const limits = resolveAgentPiOpenAiPlanningProjectionLimits({
      ContextWindowTokens: positiveInteger(this.provider.ContextWindowTokens) ?? this.config.UnknownContextWindowTokens,
      MaxOutputTokens: this.provider.MaxOutputTokens,
    });
    const contextEstimate = estimateContextTokens([...messages]);
    const branchHistoryTokens = sumMessageTokens(messages);
    const reportedContextTokens = contextEstimate.usageTokens > 0 ? contextEstimate.tokens : branchHistoryTokens;
    const fixedOverheadTokens = Math.max(0, reportedContextTokens - branchHistoryTokens);
    const messageCount = messages.length;
    const triggerTokens = threshold(limits.planningInputTokenBudget, this.config.TriggerRatio);
    const triggerMessages = threshold(limits.maxMessages, this.config.TriggerRatio);
    const hardLimitTokens = threshold(limits.planningInputTokenBudget, this.config.HardLimitRatio);
    const hardLimitMessages = threshold(limits.maxMessages, this.config.HardLimitRatio);
    const targetTokens = threshold(limits.planningInputTokenBudget, this.config.TargetRatio);
    const targetMessages = threshold(limits.maxMessages, this.config.TargetRatio);
    const recentMessageTokens = sumMessageTokens(messages.slice(-targetMessages));
    const keepRecentTokens = Math.max(1, Math.min(targetTokens, recentMessageTokens || targetTokens));
    const pressureReasons: AgentPiCompactionPressureReason[] = [];
    if (reportedContextTokens >= triggerTokens) pressureReasons.push("reported_token_threshold");
    if (branchHistoryTokens >= triggerTokens) pressureReasons.push("history_token_threshold");
    if (messageCount >= triggerMessages) pressureReasons.push("message_threshold");

    return {
      pressureReasons,
      reportedContextTokens,
      branchHistoryTokens,
      fixedOverheadTokens,
      messageCount,
      effectiveTokenBudget: limits.planningInputTokenBudget,
      effectiveMessageBudget: limits.maxMessages,
      triggerTokens,
      triggerMessages,
      requestHardLimitExceeded: reportedContextTokens >= hardLimitTokens || messageCount >= hardLimitMessages,
      hardLimitExceeded: branchHistoryTokens >= hardLimitTokens || messageCount >= hardLimitMessages,
      targetTokens,
      targetMessages,
      settings: {
        enabled: this.config.Enabled,
        reserveTokens: this.config.SummaryMaxTokens,
        keepRecentTokens,
      },
    };
  }

  private skip(
    metrics: AgentPiCompactionMetrics,
    reason: Exclude<AgentPiCompactionSkipReason, "fixed_overhead_dominant">,
  ): AgentPiCompactionPlan {
    return {
      kind: AgentPiCompactionDispositions.Skip,
      reason,
      inspection: this.inspection(metrics, {
        disposition: AgentPiCompactionDispositions.Skip,
        skipReason: reason,
      }),
    };
  }

  private reduceContextOverhead(metrics: AgentPiCompactionMetrics): AgentPiCompactionPlan {
    return {
      kind: AgentPiCompactionDispositions.ReduceContextOverhead,
      reason: AgentPiCompactionSkipReasons.FixedOverheadDominant,
      inspection: this.inspection(metrics, {
        disposition: AgentPiCompactionDispositions.ReduceContextOverhead,
        skipReason: AgentPiCompactionSkipReasons.FixedOverheadDominant,
      }),
    };
  }

  private inspection(
    metrics: AgentPiCompactionMetrics,
    result: {
      disposition: AgentPiCompactionDisposition;
      skipReason?: AgentPiCompactionSkipReason;
      compactableMessages?: readonly AgentMessage[];
      turnPrefixMessages?: readonly AgentMessage[];
    },
  ): AgentPiCompactionInspection {
    const compactableMessages = result.compactableMessages ?? [];
    const turnPrefixMessages = result.turnPrefixMessages ?? [];
    return {
      ...metrics,
      shouldCompact: result.disposition === AgentPiCompactionDispositions.Compact,
      disposition: result.disposition,
      skipReason: result.skipReason,
      compactableMessageCount: compactableMessages.length,
      turnPrefixMessageCount: turnPrefixMessages.length,
      compactableHistoryTokens: sumMessageTokens([...compactableMessages, ...turnPrefixMessages]),
    };
  }
}

function threshold(budget: number, ratio: number): number {
  return Math.max(1, Math.floor(budget * ratio));
}

function sumMessageTokens(messages: readonly AgentMessage[]): number {
  return messages.reduce((total, message) => total + estimateTokens(message), 0);
}

function positiveInteger(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
