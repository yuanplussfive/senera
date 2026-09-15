import { Temporal } from "@js-temporal/polyfill";
import { createOpaqueId } from "../Core/AgentIds.js";
import { uniqueStrings } from "../Core/AgentCollections.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import {
  AgentAgendaEventKinds,
  AgentAgendaIntentModes,
  AgentAgendaRecordKinds,
  AgentAgendaStatuses,
  type AgentAgendaIntentMode,
  type AgentAgendaRecord,
  type AgentAgendaSnapshot,
} from "./AgentAgendaTypes.js";
import type { AgentAgendaService as AgentAgendaRuntime } from "./AgentAgendaService.js";
import { agentGoalCompletionBlockReason, agentGoalDependencyBlockReason } from "./AgentGoalHierarchy.js";
import type {
  AgentWorldScheduleOccurrence,
  AgentWorldTreeProjection,
  AgentWorldWakeInput,
  AgentWorldWakePlan,
  AgentWorldWakeResult,
  AgentWorldWakeSource,
} from "../World/AgentWorldTypes.js";
import { AgentWorldActionSourceIds } from "../World/AgentWorldActionBudget.js";
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
import {
  AgentWorldWorkLedger,
  AgentWorldWorkStatuses,
  type AgentWorldWorkLease,
} from "../World/AgentWorldWorkLedger.js";

export const AgentGoalMicroLoopTriggerKinds = Object.freeze({
  Changed: "changed",
  Due: "due",
  Review: "review",
} as const);

export type AgentGoalMicroLoopTriggerKind =
  (typeof AgentGoalMicroLoopTriggerKinds)[keyof typeof AgentGoalMicroLoopTriggerKinds];

export const AgentGoalMicroLoopDecisionKinds = Object.freeze({
  Wait: "wait",
  Propose: "propose",
  AskUser: "ask_user",
  Execute: "execute",
  Replan: "replan",
  Complete: "complete",
  Block: "block",
} as const);

export type AgentGoalMicroLoopDecisionKind =
  (typeof AgentGoalMicroLoopDecisionKinds)[keyof typeof AgentGoalMicroLoopDecisionKinds];

const AutonomousGoalActionKinds = new Set<AgentGoalMicroLoopDecisionKind>([
  AgentGoalMicroLoopDecisionKinds.Execute,
  AgentGoalMicroLoopDecisionKinds.Replan,
  AgentGoalMicroLoopDecisionKinds.Complete,
]);

export interface AgentGoalMicroLoopCandidate {
  readonly goalId: string;
  readonly summary: string;
  readonly status: "planned" | "active" | "paused";
  readonly intentMode?: AgentAgendaIntentMode;
  readonly priority: number;
  readonly progress: number;
  readonly successCriteria: readonly string[];
  readonly ownerSessionId?: string | null;
  readonly trigger: AgentGoalMicroLoopTriggerKind;
  readonly triggerKey: string;
  readonly sourceRefs: readonly string[];
  readonly dueAt: string | null;
  readonly nextReviewAt: string | null;
}

export interface AgentGoalMicroLoopDecision {
  readonly goalId: string;
  readonly triggerKey: string;
  readonly kind: AgentGoalMicroLoopDecisionKind;
  readonly reason: string;
  readonly nextReviewAt?: string | null;
  readonly progress?: number;
  readonly blockedReason?: string | null;
}

export interface AgentGoalMicroLoopDecisionInput {
  readonly worldId: string;
  readonly from: Temporal.Instant;
  readonly to: Temporal.Instant;
  readonly snapshot: AgentWorldTreeProjection;
  readonly candidates: readonly AgentGoalMicroLoopCandidate[];
  readonly allowedToolNames?: readonly string[];
}

export interface AgentGoalMicroLoopDecisionPort {
  decide(
    input: AgentGoalMicroLoopDecisionInput,
  ): readonly AgentGoalMicroLoopDecision[] | Promise<readonly AgentGoalMicroLoopDecision[]>;
}

export interface AgentGoalMicroLoopActionInput {
  readonly worldId: string;
  readonly now: Temporal.Instant;
  readonly snapshot: AgentWorldTreeProjection;
  readonly candidate: AgentGoalMicroLoopCandidate;
  readonly decision: AgentGoalMicroLoopDecision;
}

export interface AgentGoalMicroLoopActionResult {
  readonly outcome: "applied" | "waiting" | "blocked" | "verified";
  readonly evidenceRefs: readonly string[];
  readonly nextReviewAt?: string | null;
  readonly progress?: number;
  readonly blockedReason?: string | null;
}

export interface AgentGoalMicroLoopActionPort {
  act(input: AgentGoalMicroLoopActionInput): AgentGoalMicroLoopActionResult | Promise<AgentGoalMicroLoopActionResult>;
}

/**
 * Coordinates one bounded, replay-safe loop across all active Agenda goals.
 * The model proposes a typed decision; this host owns persistence and the
 * action port owns any externally visible work.
 */
export class AgentGoalMicroLoopRuntime implements AgentWorldWakeSource {
  readonly sourceId = AgentWorldActionSourceIds.Goal;

  constructor(
    private readonly options: {
      readonly agenda: AgentAgendaRuntime;
      readonly timeZone: () => string;
      readonly decisionPort: AgentGoalMicroLoopDecisionPort;
      readonly actionPort: AgentGoalMicroLoopActionPort;
      readonly maxCandidates?: number | (() => number);
      /** Retry a failed Goal wake instead of pausing it permanently. */
      readonly failureReviewDelayMs?: number | (() => number);
      readonly enabled?: () => boolean;
      readonly allowedToolNames?: () => readonly string[];
      readonly workLedger?: AgentWorldWorkLedger;
      readonly leaseDurationMs?: number;
      readonly retryDelayMs?: number;
      readonly ownerId?: string;
    },
  ) {
    this.leaseOwner = resolveOwnerId(options.ownerId);
    if (typeof options.maxCandidates === "number") {
      normalizeLimit(options.maxCandidates, "Goal micro-loop candidate limit");
    }
    if (typeof options.failureReviewDelayMs === "number") {
      normalizeReviewDelay(options.failureReviewDelayMs);
    }
    if (options.workLedger) {
      normalizePositiveMilliseconds(options.leaseDurationMs, "Goal micro-loop work lease duration");
      normalizePositiveMilliseconds(options.retryDelayMs, "Goal micro-loop work retry delay");
    }
  }
  private readonly leaseOwner: string;

  wakePlan(input: { readonly worldId: string; readonly after: Temporal.Instant }): AgentWorldWakePlan {
    if (this.options.enabled && !this.options.enabled()) return { due: false, instants: [] };
    const snapshot = this.agendaSnapshot(input.after);
    if (snapshot.world.id !== input.worldId) {
      throw new Error(`Goal micro-loop world does not match the active world: ${input.worldId}`);
    }
    const scheduled = snapshot.activeGoals
      .filter((goal) => !agentGoalDependencyBlockReason(snapshot, goal))
      .map((goal) => goal.nextReviewAt ?? goal.dueAt)
      .filter((value): value is string => value !== undefined && value !== null)
      .map((value) => Temporal.Instant.from(value));
    const due = scheduled.some((instant) => Temporal.Instant.compare(instant, input.after) <= 0);
    const unique = [
      ...new Map(
        scheduled
          .filter((instant) => Temporal.Instant.compare(instant, input.after) > 0)
          .map((instant) => [instant.toString(), instant]),
      ).values(),
    ].sort(Temporal.Instant.compare);
    return { due, instants: unique };
  }

  upcomingSchedules(input: {
    readonly worldId: string;
    readonly after: Temporal.Instant;
  }): readonly AgentWorldScheduleOccurrence[] {
    if (this.options.enabled && !this.options.enabled()) return [];
    const snapshot = this.agendaSnapshot(input.after);
    if (snapshot.world.id !== input.worldId) return [];
    return snapshot.activeGoals
      .filter((goal) => !agentGoalDependencyBlockReason(snapshot, goal))
      .flatMap((goal) => {
        const at = goal.nextReviewAt ?? goal.dueAt;
        if (!at || Temporal.Instant.compare(Temporal.Instant.from(at), input.after) <= 0) return [];
        return [
          {
            scheduleId: `goal-review:${goal.id}`,
            label: goal.summary,
            at,
            actorId: goal.actor.id,
            actorRole: goal.actor.role,
            kind: AgentAgendaRecordKinds.Goal,
            source: "agenda" as const,
          },
        ];
      })
      .sort((left, right) => left.at.localeCompare(right.at) || left.scheduleId.localeCompare(right.scheduleId));
  }

  async onWake(input: AgentWorldWakeInput): Promise<AgentWorldWakeResult> {
    if (this.options.enabled && !this.options.enabled()) return { changed: false };
    const agenda = this.agendaSnapshot(input.to);
    if (agenda.world.id !== input.worldId) {
      throw new Error(`Goal micro-loop world does not match the active world: ${input.worldId}`);
    }
    const configuredLimit =
      typeof this.options.maxCandidates === "function" ? this.options.maxCandidates() : this.options.maxCandidates;
    const candidates = selectAgentGoalMicroLoopCandidates(
      agenda,
      input.from,
      input.to,
      configuredLimit === undefined ? undefined : normalizeLimit(configuredLimit, "Goal micro-loop candidate limit"),
    );
    const budget = input.budget;
    const budgetAdmittedCandidates = budget
      ? candidates.filter(
          (candidate) =>
            budget.admit({
              sourceId: this.sourceId,
              candidateId: candidate.triggerKey,
              kind: "decision",
              priority: candidate.priority,
              conflictKeys: [`goal:${candidate.goalId}`],
            }).admitted,
        )
      : candidates;
    const leases = new Map<string, AgentWorldWorkLease>();
    const admittedCandidates = this.options.workLedger
      ? budgetAdmittedCandidates.filter((candidate) => {
          const lease = this.claimWork(input, candidate);
          if (lease) leases.set(candidateKey(candidate), lease);
          return lease !== undefined;
        })
      : budgetAdmittedCandidates;
    if (admittedCandidates.length === 0) return { changed: false };

    let byKey: ReadonlyMap<string, AgentGoalMicroLoopDecision>;
    let decisions: readonly AgentGoalMicroLoopDecision[] | undefined;
    const usageLedger = new AgentModelUsageLedger();
    let usageForSettlement: AgentModelUsageValue | undefined;
    const inferenceReservation = this.reserveInference(input, admittedCandidates);
    if (!inferenceReservation.allowed) {
      const retryAt = inferenceReservation.retryAtMs;
      if (retryAt === undefined || inferenceReservation.reason === undefined) {
        throw new Error("Inference budget returned a denied decision without retry metadata.");
      }
      const error = new AgentInferenceBudgetExceededError(retryAt, inferenceReservation.reason);
      for (const candidate of admittedCandidates) {
        this.failWork(input, leases.get(candidateKey(candidate)), error, retryAt);
      }
      return { changed: false };
    }
    try {
      decisions = await withAgentModelUsageLedger(
        usageLedger,
        async () =>
          await this.options.decisionPort.decide({
            worldId: input.worldId,
            from: input.from,
            to: input.to,
            snapshot: input.snapshot,
            candidates: admittedCandidates,
            ...(this.options.allowedToolNames ? { allowedToolNames: [...this.options.allowedToolNames()] } : {}),
          }),
      );
      usageForSettlement = usageLedger.aggregate();
      byKey = validateDecisions(decisions, admittedCandidates);
    } catch (error) {
      usageForSettlement = usageLedger.aggregate();
      this.settleInference(input, inferenceReservation.reservation?.id, usageForSettlement);
      return { changed: await this.persistFailureBatch(input, admittedCandidates, error, leases) };
    }
    this.settleInference(input, inferenceReservation.reservation?.id, usageForSettlement, decisions);
    let changed = false;
    for (const candidate of admittedCandidates) {
      const decision = enforceGoalIntent(candidate, byKey.get(candidateKey(candidate))!);
      let result: boolean;
      try {
        result = await this.applyDecision(input, candidate, decision, leases.get(candidateKey(candidate)));
      } catch (error) {
        result = await this.persistFailure(input, candidate, error, leases.get(candidateKey(candidate)));
      }
      changed = result || changed;
    }
    return { changed };
  }

  private async persistFailureBatch(
    input: AgentWorldWakeInput,
    candidates: readonly AgentGoalMicroLoopCandidate[],
    error: unknown,
    leases: ReadonlyMap<string, AgentWorldWorkLease>,
  ): Promise<boolean> {
    let changed = false;
    for (const candidate of candidates) {
      changed = (await this.persistFailure(input, candidate, error, leases.get(candidateKey(candidate)))) || changed;
    }
    return changed;
  }

  private async persistFailure(
    input: AgentWorldWakeInput,
    candidate: AgentGoalMicroLoopCandidate,
    error: unknown,
    lease: AgentWorldWorkLease | undefined,
  ): Promise<boolean> {
    try {
      const nextReviewAt = this.failureReviewAt(input.to);
      const retrying = nextReviewAt !== undefined;
      const result = this.options.agenda.evolve(this.options.timeZone(), {
        recordId: candidate.goalId,
        kind: retrying ? AgentAgendaEventKinds.Progressed : AgentAgendaEventKinds.Paused,
        mutation: {
          status: retrying ? AgentAgendaStatuses.Active : AgentAgendaStatuses.Paused,
          nextReviewAt: nextReviewAt ?? null,
          progress: candidate.progress,
          ...(retrying ? {} : { blockedReason: `Goal micro-loop failed: ${errorMessage(error)}` }),
          detail: `Goal micro-loop failed: ${errorMessage(error)}`,
          lastDecisionKey: candidate.triggerKey,
        },
        sourceRefs: uniqueStrings(candidate.sourceRefs),
        authority: "host",
        occurredAt: input.to.toString(),
        idempotencyKey: `goal-micro-loop:failure:${sha256HexOfCanonicalJson({
          goalId: candidate.goalId,
          triggerKey: candidate.triggerKey,
        })}`,
      });
      this.ackWork(
        input,
        lease,
        { outcome: "failed", changed: result.disposition === "created" },
        candidate.sourceRefs,
      );
      return result.disposition === "created";
    } catch (failure) {
      input.budget?.defer(this.sourceId);
      this.failWork(input, lease, failure);
      throw failure;
    }
  }

  private failureReviewAt(now: Temporal.Instant): string | undefined {
    if (this.options.failureReviewDelayMs === undefined) return undefined;
    const delayMs =
      typeof this.options.failureReviewDelayMs === "function"
        ? this.options.failureReviewDelayMs()
        : this.options.failureReviewDelayMs;
    normalizeReviewDelay(delayMs);
    return new Date(now.epochMilliseconds + delayMs).toISOString();
  }

  private async applyDecision(
    input: AgentWorldWakeInput,
    candidate: AgentGoalMicroLoopCandidate,
    decision: AgentGoalMicroLoopDecision,
    lease: AgentWorldWorkLease | undefined,
  ): Promise<boolean> {
    try {
      const effectiveDecision =
        decision.kind === AgentGoalMicroLoopDecisionKinds.Complete
          ? (() => {
              const agendaSnapshot = this.options.agenda.snapshot(
                this.options.timeZone(),
                new Date(input.to.epochMilliseconds),
              );
              const goal = agendaSnapshot.records.find((record) => record.id === candidate.goalId);
              const blockedReason = goal ? agentGoalCompletionBlockReason(agendaSnapshot, goal) : undefined;
              return blockedReason
                ? {
                    ...decision,
                    kind: AgentGoalMicroLoopDecisionKinds.Block,
                    blockedReason,
                    reason: blockedReason,
                  }
                : decision;
            })()
          : decision;
      const action =
        effectiveDecision.kind === AgentGoalMicroLoopDecisionKinds.Wait ||
        effectiveDecision.kind === AgentGoalMicroLoopDecisionKinds.Block
          ? undefined
          : await this.options.actionPort.act({
              worldId: input.worldId,
              now: input.to,
              snapshot: input.snapshot,
              candidate,
              decision: effectiveDecision,
            });
      const state = resolveDecisionState(candidate, effectiveDecision, action, input.to);
      const sourceRefs = uniqueStrings([...candidate.sourceRefs, ...(action?.evidenceRefs ?? [])]);
      if (sourceRefs.length === 0) throw new Error(`Goal ${candidate.goalId} cannot advance without evidence.`);
      const idempotencyKey = `goal-micro-loop:${sha256HexOfCanonicalJson({
        goalId: candidate.goalId,
        triggerKey: effectiveDecision.triggerKey,
        kind: effectiveDecision.kind,
      })}`;
      const result = this.options.agenda.evolve(this.options.timeZone(), {
        recordId: candidate.goalId,
        kind: state.eventKind,
        mutation: {
          status: state.status,
          ...(state.nextReviewAt !== undefined ? { nextReviewAt: state.nextReviewAt } : {}),
          ...(state.progress !== undefined ? { progress: state.progress } : {}),
          ...(state.blockedReason !== undefined ? { blockedReason: state.blockedReason } : {}),
          lastDecisionKey: effectiveDecision.triggerKey,
          ...(effectiveDecision.reason ? { detail: effectiveDecision.reason } : {}),
        },
        sourceRefs,
        authority: "host",
        occurredAt: input.to.toString(),
        idempotencyKey,
      });
      this.ackWork(input, lease, { outcome: state.status, changed: result.disposition === "created" }, sourceRefs);
      return result.disposition === "created";
    } catch (failure) {
      input.budget?.defer(this.sourceId);
      this.failWork(input, lease, failure);
      throw failure;
    }
  }

  private claimWork(
    input: AgentWorldWakeInput,
    candidate: AgentGoalMicroLoopCandidate,
  ): AgentWorldWorkLease | undefined {
    const ledger = this.options.workLedger;
    if (!ledger) return undefined;
    const candidateId = candidateKey(candidate);
    const item = ledger.enqueue({
      worldId: input.worldId,
      sourceId: this.sourceId,
      candidateId,
      requestId: `agenda-goal:${input.worldId}:${sha256HexOfCanonicalJson({ goalId: candidate.goalId, triggerKey: candidate.triggerKey })}`,
      payload: { worldId: input.worldId, goalId: candidate.goalId, triggerKey: candidate.triggerKey },
      nextAttemptAt: input.to,
      now: input.to,
    });
    if (
      item.status === AgentWorldWorkStatuses.Acknowledged ||
      item.status === AgentWorldWorkStatuses.Cancelled ||
      item.status === AgentWorldWorkStatuses.Unknown ||
      item.status === AgentWorldWorkStatuses.ReconciliationRequired
    )
      return undefined;
    const lease = ledger.claim({
      id: item.id,
      owner: this.leaseOwner,
      now: input.to,
      leaseUntil: input.to.add({ milliseconds: this.options.leaseDurationMs! }),
    });
    if (!lease) return undefined;
    return ledger.markRunning({ id: item.id, owner: this.leaseOwner, generation: lease.generation, now: input.to });
  }

  private ackWork(
    input: AgentWorldWakeInput,
    lease: AgentWorldWorkLease | undefined,
    result: unknown,
    evidenceRefs: readonly string[],
  ): void {
    if (!this.options.workLedger || !lease || !lease.item.id) return;
    this.options.workLedger.ack({
      id: lease.item.id,
      owner: this.leaseOwner,
      generation: lease.generation,
      now: input.to,
      result,
      evidenceRefs,
    });
  }

  private failWork(
    input: AgentWorldWakeInput,
    lease: AgentWorldWorkLease | undefined,
    error: unknown,
    retryAtMs?: number,
  ): void {
    if (!this.options.workLedger || !lease || !lease.item.id) return;
    this.options.workLedger.fail({
      id: lease.item.id,
      owner: this.leaseOwner,
      generation: lease.generation,
      now: input.to,
      error: errorMessage(error),
      nextAttemptAt:
        retryAtMs === undefined
          ? input.to.add({ milliseconds: this.options.retryDelayMs! })
          : Temporal.Instant.fromEpochMilliseconds(retryAtMs),
    });
  }

  private reserveInference(input: AgentWorldWakeInput, candidates: readonly AgentGoalMicroLoopCandidate[]) {
    if (!input.inferenceBudget) return { allowed: true } as const;
    return input.inferenceBudget.reserve({
      scope: requireAgentInferenceScope(input.inferenceBudgetScope),
      lane: AgentInferenceLaneIds.Goal,
      sourceId: this.sourceId,
      requestId: `goal-micro-loop:${input.worldId}:${candidates.map((candidate) => candidate.triggerKey).join("|")}`,
      estimatedInputTokens: estimateAgentInferenceTokens({
        worldId: input.worldId,
        from: input.from.toString(),
        to: input.to.toString(),
        snapshot: input.snapshot,
        candidates,
      }),
      priority: candidates.reduce((highest, candidate) => Math.max(highest, candidate.priority), 0),
    });
  }

  private settleInference(
    input: AgentWorldWakeInput,
    reservationId: string | undefined,
    usage?: AgentModelUsageValue,
    decisions?: readonly AgentGoalMicroLoopDecision[],
  ): void {
    if (!reservationId) return;
    input.inferenceBudget?.settle({
      reservationId,
      ...(usage?.inputTokens !== undefined ? { actualInputTokens: usage.inputTokens } : {}),
      ...(usage?.outputTokens !== undefined
        ? { actualOutputTokens: usage.outputTokens }
        : decisions !== undefined
          ? { actualOutputTokens: estimateAgentInferenceTokens(decisions) }
          : {}),
    });
  }

  private agendaSnapshot(now: Temporal.Instant): AgentAgendaSnapshot {
    return this.options.agenda.snapshot(this.options.timeZone(), new Date(now.epochMilliseconds));
  }
}

export function selectAgentGoalMicroLoopCandidates(
  snapshot: AgentAgendaSnapshot,
  from: Temporal.Instant,
  to: Temporal.Instant,
  maximum?: number,
): AgentGoalMicroLoopCandidate[] {
  const candidates = snapshot.activeGoals.flatMap((goal) => {
    if (agentGoalDependencyBlockReason(snapshot, goal)) return [];
    const reviewAt = goal.nextReviewAt ? Temporal.Instant.from(goal.nextReviewAt) : undefined;
    const dueAt = goal.dueAt ? Temporal.Instant.from(goal.dueAt) : undefined;
    const updatedAt = Temporal.Instant.from(goal.updatedAt);
    const reviewDue = reviewAt !== undefined && Temporal.Instant.compare(reviewAt, to) <= 0;
    const due =
      dueAt !== undefined && Temporal.Instant.compare(dueAt, to) <= 0 && (reviewAt === undefined || reviewDue);
    const changed = Temporal.Instant.compare(updatedAt, from) > 0 && Temporal.Instant.compare(updatedAt, to) <= 0;
    // A new mutation must wake the loop even when an older review remains scheduled in the future.
    const trigger = reviewDue
      ? AgentGoalMicroLoopTriggerKinds.Review
      : due
        ? AgentGoalMicroLoopTriggerKinds.Due
        : changed
          ? AgentGoalMicroLoopTriggerKinds.Changed
          : undefined;
    if (!trigger) return [];
    return [toCandidate(goal, trigger)];
  });
  const ordered = candidates.sort(
    (left, right) => right.priority - left.priority || left.goalId.localeCompare(right.goalId),
  );
  return maximum === undefined ? ordered : ordered.slice(0, maximum);
}

function toCandidate(goal: AgentAgendaRecord, trigger: AgentGoalMicroLoopTriggerKind): AgentGoalMicroLoopCandidate {
  const triggerValue = goal.nextReviewAt ?? goal.dueAt ?? goal.lastEventId;
  return {
    goalId: goal.id,
    summary: goal.summary,
    status: AgentAgendaStatuses.Active,
    ...(goal.intentMode ? { intentMode: goal.intentMode } : {}),
    priority: goal.priority ?? 50,
    progress: goal.progress ?? 0,
    successCriteria: [...(goal.successCriteria ?? [])],
    ...(goal.ownerSessionId !== undefined ? { ownerSessionId: goal.ownerSessionId } : {}),
    trigger,
    triggerKey: `${goal.id}:${trigger}:${triggerValue}:${goal.lastEventId}`,
    sourceRefs: [...goal.sourceRefs],
    dueAt: goal.dueAt,
    nextReviewAt: goal.nextReviewAt ?? null,
  };
}

function validateDecisions(
  decisions: readonly AgentGoalMicroLoopDecision[],
  candidates: readonly AgentGoalMicroLoopCandidate[],
): ReadonlyMap<string, AgentGoalMicroLoopDecision> {
  if (!Array.isArray(decisions) || decisions.length !== candidates.length) {
    throw new Error(
      `Goal micro-loop decision must resolve every candidate: expected ${candidates.length}, received ${Array.isArray(decisions) ? decisions.length : "non-array"}.`,
    );
  }
  const available = new Map(candidates.map((candidate) => [candidateKey(candidate), candidate] as const));
  const resolved = new Map<string, AgentGoalMicroLoopDecision>();
  for (const decision of decisions) {
    if (!decision || typeof decision !== "object") throw new Error("Goal micro-loop decision must be an object.");
    const goalId = requireText(decision.goalId, "Goal micro-loop decision goal id");
    const triggerKey = requireText(decision.triggerKey, "Goal micro-loop decision trigger key");
    const key = `${goalId}\u0000${triggerKey}`;
    if (!available.has(key)) throw new Error(`Goal micro-loop decision selected an unknown candidate: ${key}`);
    if (resolved.has(key)) throw new Error(`Goal micro-loop decision selected a candidate more than once: ${key}`);
    if (!Object.values(AgentGoalMicroLoopDecisionKinds).includes(decision.kind)) {
      throw new Error(`Goal micro-loop decision kind is unsupported: ${String(decision.kind)}.`);
    }
    requireText(decision.reason, "Goal micro-loop decision reason");
    if (decision.nextReviewAt !== undefined && decision.nextReviewAt !== null) {
      Temporal.Instant.from(requireText(decision.nextReviewAt, "Goal micro-loop next review time"));
    }
    if (
      decision.progress !== undefined &&
      (!Number.isFinite(decision.progress) || decision.progress < 0 || decision.progress > 1)
    ) {
      throw new Error("Goal micro-loop decision progress must be between 0 and 1.");
    }
    resolved.set(key, decision);
  }
  return resolved;
}

function resolveDecisionState(
  candidate: AgentGoalMicroLoopCandidate,
  decision: AgentGoalMicroLoopDecision,
  action: AgentGoalMicroLoopActionResult | undefined,
  now: Temporal.Instant,
): {
  readonly status: "active" | "paused" | "completed";
  readonly eventKind: "progressed" | "paused" | "finished";
  readonly nextReviewAt?: string | null;
  readonly progress?: number;
  readonly blockedReason?: string | null;
} {
  if (decision.kind === AgentGoalMicroLoopDecisionKinds.Wait) {
    const nextReviewAt = requireFutureReview(decision.nextReviewAt, now, decision.kind);
    return { status: AgentAgendaStatuses.Active, eventKind: AgentAgendaEventKinds.Progressed, nextReviewAt };
  }
  if (decision.kind === AgentGoalMicroLoopDecisionKinds.Block) {
    return {
      status: AgentAgendaStatuses.Paused,
      eventKind: AgentAgendaEventKinds.Paused,
      progress: candidate.progress,
      nextReviewAt: null,
      blockedReason: decision.blockedReason ?? decision.reason,
    };
  }
  if (!action) throw new Error(`Goal micro-loop decision ${decision.kind} requires an action port result.`);
  if (!Object.values(["applied", "waiting", "blocked", "verified"]).includes(action.outcome)) {
    throw new Error(`Goal micro-loop action outcome is unsupported: ${String(action.outcome)}.`);
  }
  const progress = action.progress ?? decision.progress ?? candidate.progress;
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new Error("Goal micro-loop action progress must be between 0 and 1.");
  }
  if (decision.kind === AgentGoalMicroLoopDecisionKinds.Complete) {
    if (action.outcome === "waiting" && action.nextReviewAt) {
      return {
        status: AgentAgendaStatuses.Active,
        eventKind: AgentAgendaEventKinds.Progressed,
        progress,
        nextReviewAt: requireFutureReview(action.nextReviewAt, now, decision.kind),
      };
    }
    if (action.outcome !== "verified") throw new Error("A goal can be completed only with verified action evidence.");
    return {
      status: AgentAgendaStatuses.Completed,
      eventKind: AgentAgendaEventKinds.Finished,
      progress: 1,
      nextReviewAt: null,
    };
  }
  if (action.outcome === "blocked") {
    return {
      status: AgentAgendaStatuses.Paused,
      eventKind: AgentAgendaEventKinds.Paused,
      progress,
      nextReviewAt: null,
      blockedReason: action.blockedReason ?? decision.blockedReason ?? decision.reason,
    };
  }
  if (action.outcome === "waiting") {
    if (
      action.nextReviewAt &&
      (decision.kind === AgentGoalMicroLoopDecisionKinds.Execute ||
        decision.kind === AgentGoalMicroLoopDecisionKinds.Replan)
    ) {
      return {
        status: AgentAgendaStatuses.Active,
        eventKind: AgentAgendaEventKinds.Progressed,
        progress,
        nextReviewAt: requireFutureReview(action.nextReviewAt, now, decision.kind),
      };
    }
    return {
      status: AgentAgendaStatuses.Paused,
      eventKind: AgentAgendaEventKinds.Paused,
      progress,
      nextReviewAt: null,
      blockedReason: action.blockedReason ?? decision.reason,
    };
  }
  if (
    decision.kind === AgentGoalMicroLoopDecisionKinds.AskUser ||
    decision.kind === AgentGoalMicroLoopDecisionKinds.Propose
  ) {
    return {
      status: AgentAgendaStatuses.Paused,
      eventKind: AgentAgendaEventKinds.Paused,
      progress,
      nextReviewAt: null,
      blockedReason: action.blockedReason ?? decision.reason,
    };
  }
  const nextReviewAt = requireFutureReview(action.nextReviewAt ?? decision.nextReviewAt, now, decision.kind);
  return {
    status: AgentAgendaStatuses.Active,
    eventKind: AgentAgendaEventKinds.Progressed,
    progress,
    nextReviewAt,
  };
}

function requireFutureReview(value: string | null | undefined, now: Temporal.Instant, kind: string): string {
  if (!value) throw new Error(`Goal micro-loop decision ${kind} must schedule a future review or become terminal.`);
  const next = Temporal.Instant.from(value);
  if (Temporal.Instant.compare(next, now) <= 0) {
    throw new Error(`Goal micro-loop decision ${kind} must schedule a review after the current wake.`);
  }
  return next.toString();
}

function candidateKey(candidate: Pick<AgentGoalMicroLoopCandidate, "goalId" | "triggerKey">): string {
  return `${candidate.goalId}\u0000${candidate.triggerKey}`;
}

function enforceGoalIntent(
  candidate: AgentGoalMicroLoopCandidate,
  decision: AgentGoalMicroLoopDecision,
): AgentGoalMicroLoopDecision {
  if (!AutonomousGoalActionKinds.has(decision.kind)) return decision;
  if (candidate.intentMode === AgentAgendaIntentModes.Committed) return decision;
  const intentMode = candidate.intentMode ?? AgentAgendaIntentModes.Tentative;
  return {
    ...decision,
    kind: AgentGoalMicroLoopDecisionKinds.Block,
    reason: `Goal intent mode ${intentMode} requires explicit commitment before autonomous execution.`,
    blockedReason: `Goal intent mode ${intentMode} is not authorized for autonomous execution.`,
  };
}

function normalizeLimit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100)
    throw new RangeError(`${label} must be between 1 and 100.`);
  return value;
}

function normalizeReviewDelay(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1_000) {
    throw new RangeError("Goal micro-loop failure review delay must be a safe integer of at least 1000 ms.");
  }
  return value;
}

function normalizePositiveMilliseconds(value: number | undefined, label: string): asserts value is number {
  if (value === undefined || !Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer.`);
  }
}

function resolveOwnerId(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : createOpaqueId("agenda-goal-worker");
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}
