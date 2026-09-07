import { Temporal } from "@js-temporal/polyfill";
import { createOpaqueId } from "../Core/AgentIds.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { AgentWorldActionSourceIds } from "./AgentWorldActionBudget.js";
import { AgentWorldWorkLedger, type AgentWorldWorkItem, type AgentWorldWorkLease } from "./AgentWorldWorkLedger.js";
import {
  AgentInferenceBudgetExceededError,
  AgentInferenceLaneIds,
  estimateAgentInferenceTokens,
  requireAgentInferenceScope,
} from "../ModelEndpoints/AgentInferenceBudget.js";
import {
  AgentModelUsageLedger,
  withAgentModelUsageLedger,
  type AgentModelUsageValue,
} from "../ModelEndpoints/AgentModelUsage.js";
import type {
  AgentWorldTreeProjection,
  AgentWorldWakeInput,
  AgentWorldWakePlan,
  AgentWorldWakeResult,
  AgentWorldWakeSource,
} from "./AgentWorldTypes.js";

export const AgentWorldResidentIdleDecisionKinds = Object.freeze({
  Wait: "wait",
  Reflect: "reflect",
  CreateGoal: "create_goal",
  Notify: "notify",
} as const);

export const AgentWorldResidentIdleWaitReasons = Object.freeze({
  NoSalientChange: "salience_unchanged",
} as const);

export type AgentWorldResidentIdleDecisionKind =
  (typeof AgentWorldResidentIdleDecisionKinds)[keyof typeof AgentWorldResidentIdleDecisionKinds];

export interface AgentWorldResidentIdleGoalProposal {
  readonly summary: string;
  readonly detail?: string;
  readonly priority?: number;
  readonly successCriteria?: readonly string[];
}

export interface AgentWorldResidentIdleDecision {
  readonly kind: AgentWorldResidentIdleDecisionKind;
  readonly reason: string;
  readonly goal?: AgentWorldResidentIdleGoalProposal;
  readonly message?: string;
}

export interface AgentWorldResidentIdleDecisionInput {
  readonly worldId: string;
  readonly now: Temporal.Instant;
  readonly snapshot: AgentWorldTreeProjection;
  readonly streak: number;
}

export interface AgentWorldResidentIdleDecisionPort {
  decide(input: AgentWorldResidentIdleDecisionInput): Promise<AgentWorldResidentIdleDecision>;
}

export interface AgentWorldResidentIdleActionInput {
  readonly worldId: string;
  readonly workItemId: string;
  readonly now: Temporal.Instant;
  readonly snapshot: AgentWorldTreeProjection;
  readonly decision: AgentWorldResidentIdleDecision;
}

export interface AgentWorldResidentIdleActionResult {
  readonly changed: boolean;
  readonly evidenceRefs: readonly string[];
  readonly result?: unknown;
}

export interface AgentWorldResidentIdleActionPort {
  execute(
    input: AgentWorldResidentIdleActionInput,
  ): AgentWorldResidentIdleActionResult | Promise<AgentWorldResidentIdleActionResult>;
}

export interface AgentWorldResidentIdleRuntimeConfig {
  readonly enabled: boolean;
  readonly minIntervalMs: number;
  readonly maxIntervalMs: number;
  readonly backoffMultiplier: number;
  readonly maxPending: number;
}

interface ResidentIdleWorkPayload {
  readonly version: 1;
  readonly streak: number;
  readonly salienceFingerprint?: string;
}

/**
 * Sparse Resident cognition. Cadence and replay state live in the durable
 * work ledger; the model can choose a typed outcome but never a timer or tool.
 */
export class AgentWorldResidentIdleRuntime implements AgentWorldWakeSource {
  readonly sourceId = AgentWorldActionSourceIds.ResidentIdle;
  readonly fairShareEligible = false;
  private readonly leaseOwner: string;

  constructor(
    private readonly options: {
      readonly workLedger: AgentWorldWorkLedger;
      readonly decisionPort: AgentWorldResidentIdleDecisionPort;
      readonly actionPort: AgentWorldResidentIdleActionPort;
      readonly config: () => AgentWorldResidentIdleRuntimeConfig;
      readonly leaseDurationMs: () => number;
      readonly retryDelayMs: () => number;
      readonly ownerId?: string;
    },
  ) {
    const owner = options.ownerId?.trim();
    this.leaseOwner = owner ? owner : createOpaqueId("resident-idle-worker");
  }

  ensureScheduled(worldId: string, now: Temporal.Instant): AgentWorldWorkItem | undefined {
    const config = this.readConfig();
    if (!config.enabled) return undefined;
    if (this.options.workLedger.hasOutstanding(worldId, this.sourceId)) return undefined;
    const scheduledAt = now.add({ milliseconds: config.minIntervalMs });
    const candidateId = `idle:${scheduledAt.toString()}`;
    return this.options.workLedger.enqueue({
      worldId,
      sourceId: this.sourceId,
      candidateId,
      requestId: `resident-idle:${worldId}:${candidateId}`,
      payload: { version: 1, streak: 0 } satisfies ResidentIdleWorkPayload,
      nextAttemptAt: scheduledAt,
      now,
    });
  }

  wakePlan(input: { readonly worldId: string; readonly after: Temporal.Instant }): AgentWorldWakePlan {
    if (!this.readConfig().enabled) return { due: false, instants: [] };
    const nextDueAt = this.options.workLedger.nextDueAt(input.worldId, this.sourceId);
    if (!nextDueAt) return { due: false, instants: [] };
    const due = Temporal.Instant.from(nextDueAt);
    if (Temporal.Instant.compare(due, input.after) <= 0) return { due: true, instants: [] };
    return { due: false, instants: [due] };
  }

  upcomingSchedules(_input: { readonly worldId: string; readonly after: Temporal.Instant }): readonly [] {
    return [];
  }

  async onWake(input: AgentWorldWakeInput): Promise<AgentWorldWakeResult> {
    const config = this.readConfig();
    if (!config.enabled) return { changed: false };
    const due = this.options.workLedger.listDue({
      worldId: input.worldId,
      sourceId: this.sourceId,
      now: input.to,
      limit: config.maxPending,
    });
    if (due.length === 0) return { changed: false };
    if (!input.budget) throw new Error("Resident idle wake requires the shared action budget.");

    let changed = false;
    for (const item of due) {
      const payload = normalizePayload(item.payload);
      const admission = input.budget.admit({
        sourceId: this.sourceId,
        candidateId: item.candidateId,
        kind: "decision",
        priority: 0,
        conflictKeys: ["resident:idle"],
      });
      if (!admission.admitted) continue;
      const lease = this.claim(input, item);
      if (!lease) continue;
      const fingerprint = salienceFingerprint(input.snapshot);
      const needsModelDecision = payload.salienceFingerprint !== fingerprint;
      const inferenceReservation = needsModelDecision
        ? input.inferenceBudget?.reserve({
            scope: requireAgentInferenceScope(input.inferenceBudgetScope),
            lane: AgentInferenceLaneIds.Resident,
            sourceId: this.sourceId,
            requestId: `resident-idle:${input.worldId}:${item.id}`,
            estimatedInputTokens: estimateAgentInferenceTokens({
              worldId: input.worldId,
              now: input.to.toString(),
              snapshot: input.snapshot,
              streak: payload.streak,
            }),
            priority: 0,
          })
        : undefined;
      if (inferenceReservation && !inferenceReservation.allowed) {
        if (inferenceReservation.retryAtMs === undefined || inferenceReservation.reason === undefined) {
          throw new Error("Inference budget returned a denied decision without retry metadata.");
        }
        input.budget.defer(this.sourceId);
        this.fail(
          input,
          lease,
          new AgentInferenceBudgetExceededError(inferenceReservation.retryAtMs, inferenceReservation.reason),
          inferenceReservation.retryAtMs,
        );
        continue;
      }
      const usageLedger = needsModelDecision ? new AgentModelUsageLedger() : undefined;
      let usageForSettlement: AgentModelUsageValue | undefined;
      let decisionForSettlement: AgentWorldResidentIdleDecision | undefined;
      try {
        const decision =
          payload.salienceFingerprint === fingerprint
            ? {
                kind: AgentWorldResidentIdleDecisionKinds.Wait,
                reason: AgentWorldResidentIdleWaitReasons.NoSalientChange,
              }
            : normalizeDecision(
                await withAgentModelUsageLedger(usageLedger!, () =>
                  this.options.decisionPort.decide({
                    worldId: input.worldId,
                    now: input.to,
                    snapshot: input.snapshot,
                    streak: payload.streak,
                  }),
                ),
              );
        decisionForSettlement = decision;
        usageForSettlement = usageLedger?.aggregate();
        const action =
          decision.kind === AgentWorldResidentIdleDecisionKinds.Wait
            ? { changed: false, evidenceRefs: [] as readonly string[] }
            : await this.options.actionPort.execute({
                worldId: input.worldId,
                workItemId: item.id,
                now: input.to,
                snapshot: input.snapshot,
                decision,
              });
        const evidenceRefs = normalizeEvidenceRefs(action.evidenceRefs);
        this.options.workLedger.ack({
          id: lease.item.id,
          owner: this.leaseOwner,
          generation: lease.generation,
          now: input.to,
          result: { decision, action: action.result },
          evidenceRefs,
        });
        this.scheduleNext(
          input.worldId,
          input.to,
          nextStreak(payload.streak, decision.kind, maxBackoffStreak(config)),
          fingerprint,
          config,
        );
        changed = action.changed || changed;
      } catch (error) {
        input.budget.defer(this.sourceId);
        this.fail(input, lease, error);
        throw error;
      } finally {
        usageForSettlement = usageForSettlement ?? usageLedger?.aggregate();
        if (inferenceReservation?.reservation) {
          input.inferenceBudget?.settle({
            reservationId: inferenceReservation.reservation.id,
            ...(usageForSettlement?.inputTokens !== undefined
              ? { actualInputTokens: usageForSettlement.inputTokens }
              : {}),
            ...(decisionForSettlement
              ? {
                  actualOutputTokens:
                    usageForSettlement?.outputTokens ?? estimateAgentInferenceTokens(decisionForSettlement),
                }
              : {}),
          });
        }
      }
    }
    if (due.length === config.maxPending) input.budget.defer(this.sourceId);
    return { changed };
  }

  private claim(input: AgentWorldWakeInput, item: AgentWorldWorkItem): AgentWorldWorkLease | undefined {
    const leaseDurationMs = this.options.leaseDurationMs();
    if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs <= 0) {
      throw new RangeError("Resident idle lease duration must be a positive safe integer.");
    }
    const lease = this.options.workLedger.claim({
      id: item.id,
      owner: this.leaseOwner,
      now: input.to,
      leaseUntil: input.to.add({ milliseconds: leaseDurationMs }),
    });
    return lease
      ? this.options.workLedger.markRunning({
          id: item.id,
          owner: this.leaseOwner,
          generation: lease.generation,
          now: input.to,
        })
      : undefined;
  }

  private fail(input: AgentWorldWakeInput, lease: AgentWorldWorkLease, error: unknown, retryAtMs?: number): void {
    const retryDelayMs = this.options.retryDelayMs();
    if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs <= 0) {
      throw new RangeError("Resident idle retry delay must be a positive safe integer.");
    }
    this.options.workLedger.fail({
      id: lease.item.id,
      owner: this.leaseOwner,
      generation: lease.generation,
      now: input.to,
      error: errorMessage(error),
      nextAttemptAt:
        retryAtMs === undefined
          ? input.to.add({ milliseconds: retryDelayMs })
          : Temporal.Instant.fromEpochMilliseconds(retryAtMs),
    });
  }

  private scheduleNext(
    worldId: string,
    now: Temporal.Instant,
    streak: number,
    salienceFingerprintValue: string,
    config: AgentWorldResidentIdleRuntimeConfig,
  ) {
    const delay = Math.min(config.maxIntervalMs, config.minIntervalMs * config.backoffMultiplier ** streak);
    const scheduledAt = now.add({ milliseconds: Math.max(config.minIntervalMs, Math.round(delay)) });
    const candidateId = `idle:${scheduledAt.toString()}`;
    this.options.workLedger.enqueue({
      worldId,
      sourceId: this.sourceId,
      candidateId,
      requestId: `resident-idle:${worldId}:${candidateId}`,
      payload: { version: 1, streak, salienceFingerprint: salienceFingerprintValue } satisfies ResidentIdleWorkPayload,
      nextAttemptAt: scheduledAt,
      now,
    });
  }

  private readConfig(): AgentWorldResidentIdleRuntimeConfig {
    const config = this.options.config();
    if (!config.enabled) return config;
    if (!Number.isSafeInteger(config.minIntervalMs) || config.minIntervalMs <= 0) {
      throw new RangeError("Resident idle min interval must be a positive safe integer.");
    }
    if (!Number.isSafeInteger(config.maxIntervalMs) || config.maxIntervalMs < config.minIntervalMs) {
      throw new RangeError("Resident idle max interval must be at least the min interval.");
    }
    if (!Number.isFinite(config.backoffMultiplier) || config.backoffMultiplier < 1) {
      throw new RangeError("Resident idle backoff multiplier must be at least 1.");
    }
    if (!Number.isSafeInteger(config.maxPending) || config.maxPending <= 0) {
      throw new RangeError("Resident idle max pending must be a positive safe integer.");
    }
    return config;
  }
}

function normalizePayload(value: unknown): ResidentIdleWorkPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Resident idle work payload must be an object.");
  }
  const payload = value as Partial<ResidentIdleWorkPayload>;
  const streak = payload.streak;
  if (payload.version !== 1 || typeof streak !== "number" || !Number.isSafeInteger(streak) || streak < 0) {
    throw new Error("Resident idle work payload is invalid.");
  }
  if (
    payload.salienceFingerprint !== undefined &&
    (typeof payload.salienceFingerprint !== "string" || payload.salienceFingerprint.trim().length === 0)
  ) {
    throw new Error("Resident idle salience fingerprint is invalid.");
  }
  return {
    version: 1,
    streak,
    ...(payload.salienceFingerprint ? { salienceFingerprint: payload.salienceFingerprint.trim() } : {}),
  };
}

function normalizeDecision(value: AgentWorldResidentIdleDecision): AgentWorldResidentIdleDecision {
  if (!value || typeof value !== "object") throw new Error("Resident idle decision must be an object.");
  if (!Object.values(AgentWorldResidentIdleDecisionKinds).includes(value.kind)) {
    throw new Error(`Unsupported Resident idle decision kind: ${String(value.kind)}.`);
  }
  if (typeof value.reason !== "string" || value.reason.trim().length === 0) {
    throw new Error("Resident idle decision reason must be non-empty.");
  }
  return {
    ...value,
    reason: value.reason.trim(),
    ...(value.message !== undefined ? { message: requireText(value.message, "Resident idle decision message") } : {}),
  };
}

function normalizeEvidenceRefs(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Resident idle evidence references must be an array.");
  return value.map((entry) => requireText(entry, "Resident idle evidence reference"));
}

function nextStreak(streak: number, kind: AgentWorldResidentIdleDecisionKind, maximum: number): number {
  return kind === AgentWorldResidentIdleDecisionKinds.Wait ? Math.min(streak + 1, maximum) : 0;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be non-empty.`);
  return value.trim();
}

function salienceFingerprint(snapshot: AgentWorldTreeProjection): string {
  return sha256HexOfCanonicalJson({
    worldId: snapshot.world.id,
    phase: snapshot.time.phaseId,
    localDate: snapshot.time.localDate,
    resident: snapshot.resident,
    changedNodeIds: snapshot.changedNodeIds,
    commitments: snapshot.commitments.map((commitment) => ({
      id: commitment.id,
      status: commitment.status,
      progress: commitment.progress,
      nextReviewAt: commitment.nextReviewAt,
      blockedReason: commitment.blockedReason,
    })),
    timeline: snapshot.timeline.slice(-8).map((entry) => ({
      id: entry.id,
      type: entry.type,
      occurredAt: entry.occurredAt,
      summary: entry.summary,
      changedEntityIds: entry.changedEntityIds,
    })),
  });
}

function maxBackoffStreak(config: AgentWorldResidentIdleRuntimeConfig): number {
  if (config.backoffMultiplier <= 1 || config.maxIntervalMs <= config.minIntervalMs) return 0;
  return Math.max(
    0,
    Math.ceil(Math.log(config.maxIntervalMs / config.minIntervalMs) / Math.log(config.backoffMultiplier)),
  );
}
