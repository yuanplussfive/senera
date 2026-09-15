import { Temporal } from "@js-temporal/polyfill";
import { createOpaqueId } from "../Core/AgentIds.js";
import { errorMessage } from "../Core/AgentErrors.js";
import type { ResolvedAgentWorldConfig } from "../Types/AgentRuntimeConfigTypes.js";
import {
  AgentAutonomyModes,
  AgentHabitOccurrenceReasons,
  AgentHabitDefinitionKinds,
  type AgentAutonomyMode,
  type AgentHabitDefinition,
  type AgentHabitOccurrenceCandidate,
  type AgentHabitOccurrencePage,
  type AgentHabitScheduler,
} from "./AgentHabitScheduler.js";
import type {
  AgentWorldScheduleOccurrence,
  AgentWorldTreeProjection,
  AgentWorldWakePlan,
  AgentWorldWakeInput,
  AgentWorldWakeResult,
  AgentWorldWakeSource,
} from "./AgentWorldTypes.js";
import { AgentWorldActionSourceIds } from "./AgentWorldActionBudget.js";
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
import { AgentWorldWorkLedger, AgentWorldWorkStatuses, type AgentWorldWorkLease } from "./AgentWorldWorkLedger.js";

export interface AgentWorldAutonomyDefinition extends Omit<AgentHabitDefinition, "kind" | "autonomyMode"> {
  readonly mode: AgentAutonomyMode;
}

export interface AgentWorldAutonomyCandidate {
  readonly routineId: string;
  readonly occurrenceAt: string;
  readonly eligibleUntil: string;
  readonly summary: string;
  readonly actorId: string;
  readonly priority: number;
  readonly mode: AgentAutonomyMode;
}

export interface AgentWorldAutonomyDecisionInput {
  readonly worldId: string;
  readonly now: Temporal.Instant;
  readonly snapshot: AgentWorldTreeProjection;
  readonly candidates: readonly AgentWorldAutonomyCandidate[];
}

export interface AgentWorldAutonomySelection {
  readonly routineId: string;
  readonly occurrenceAt: string;
  readonly disposition: AgentWorldAutonomyDecisionDisposition;
}

export const AgentWorldAutonomyDecisionDispositions = Object.freeze({
  Apply: "apply",
  Skip: "skip",
} as const);
export type AgentWorldAutonomyDecisionDisposition =
  (typeof AgentWorldAutonomyDecisionDispositions)[keyof typeof AgentWorldAutonomyDecisionDispositions];

export interface AgentWorldAutonomyDecisionPort {
  select(input: AgentWorldAutonomyDecisionInput): Promise<readonly AgentWorldAutonomySelection[]>;
}

/**
 * Runs package-declared resident routines on the shared habit ledger. It does
 * not invent routines, entities, or life events; an empty package means no
 * autonomous activity. Model-backed decisions are an explicit capability and
 * never replace deterministic scheduled routines.
 */
export class AgentWorldAutonomyRuntime implements AgentWorldWakeSource {
  readonly sourceId = AgentWorldActionSourceIds.Autonomy;

  constructor(
    private readonly options: {
      readonly habits: AgentHabitScheduler;
      readonly config: () => ResolvedAgentWorldConfig;
      readonly decisionPort?: AgentWorldAutonomyDecisionPort;
      readonly workLedger?: AgentWorldWorkLedger;
      readonly leaseDurationMs?: number;
      readonly retryDelayMs?: number;
      readonly ownerId?: string;
    },
  ) {
    this.leaseOwner = resolveOwnerId(options.ownerId);
    if (options.workLedger) {
      assertPositiveMilliseconds(options.leaseDurationMs, "World autonomy work lease duration");
      assertPositiveMilliseconds(options.retryDelayMs, "World autonomy work retry delay");
    }
  }

  private readonly leaseOwner: string;

  register(worldId: string, definition: AgentWorldAutonomyDefinition, now?: Temporal.Instant): void {
    if (!Object.values(AgentAutonomyModes).includes(definition.mode)) {
      throw new Error(`Unsupported world autonomy mode: ${String(definition.mode)}`);
    }
    if (definition.mode === AgentAutonomyModes.Decision && !this.options.decisionPort) {
      throw new Error(`Autonomy routine ${definition.id} requires a decision port.`);
    }
    const { mode, ...habitDefinition } = definition;
    this.options.habits.register(
      worldId,
      {
        ...habitDefinition,
        kind: AgentHabitDefinitionKinds.Autonomy,
        autonomyMode: mode,
      },
      now,
    );
  }

  unregister(worldId: string, routineId: string, now?: Temporal.Instant): void {
    this.options.habits.unregister(worldId, routineId, now);
  }

  list(worldId: string): AgentWorldAutonomyDefinition[] {
    return this.options.habits
      .list(worldId)
      .filter((definition) => definition.kind === AgentHabitDefinitionKinds.Autonomy)
      .map((definition) => {
        if (!definition.autonomyMode) {
          throw new Error(`Autonomy routine ${definition.id} has no autonomy mode.`);
        }
        const mode = definition.autonomyMode;
        const { kind: _kind, autonomyMode: _autonomyMode, ...base } = definition;
        return { ...base, mode };
      });
  }

  wakePlan(input: { readonly worldId: string; readonly after: Temporal.Instant }): AgentWorldWakePlan {
    return this.options.habits.evaluationWakePlan(input.worldId, input.after, AgentHabitDefinitionKinds.Autonomy);
  }

  upcomingSchedules(input: {
    readonly worldId: string;
    readonly after: Temporal.Instant;
  }): readonly AgentWorldScheduleOccurrence[] {
    return this.options.habits.upcoming(input.worldId, input.after, AgentHabitDefinitionKinds.Autonomy);
  }

  async onWake(input: AgentWorldWakeInput): Promise<AgentWorldWakeResult> {
    const maximumOccurrences = input.budget
      ? Math.max(1, input.budget.remainingActions + 1)
      : this.options.config().HabitCatchUpLimit;
    const page = readCandidatePage(this.options.habits, {
      worldId: input.worldId,
      to: input.to,
      maximumOccurrences,
      definitionKind: AgentHabitDefinitionKinds.Autonomy,
    });
    if (page.hasMore && !input.budget) {
      throw new Error(
        `Autonomy recovery requires more than the configured compatibility limit ${maximumOccurrences} occurrences.`,
      );
    }
    const candidates = [...page.candidates];
    const orderedCandidates = [...candidates].sort(compareAutonomyCandidates);
    const budget = input.budget;
    const budgetAdmittedCandidates = budget
      ? orderedCandidates.filter((candidate) => {
          const mode = autonomyMode(candidate);
          return budget.admit({
            sourceId: this.sourceId,
            candidateId: candidateKey(candidate),
            kind: mode === AgentAutonomyModes.Decision ? "decision" : "action",
            priority: candidate.definition.priority,
            conflictKeys: [`autonomy:${candidateKey(candidate)}`],
          }).admitted;
        })
      : orderedCandidates;
    const leases = new Map<string, AgentWorldWorkLease>();
    const admittedCandidates = this.options.workLedger
      ? budgetAdmittedCandidates.filter((candidate) => {
          const lease = this.claimWork(input, candidate);
          if (lease) leases.set(candidateKey(candidate), lease);
          return lease !== undefined;
        })
      : budgetAdmittedCandidates;
    if (page.hasMore && budget) budget.defer(this.sourceId);
    if (admittedCandidates.length === 0) return { changed: false };

    const automatic = admittedCandidates.filter(
      (candidate) => autonomyMode(candidate) === AgentAutonomyModes.Automatic,
    );
    const decisions = admittedCandidates.filter((candidate) => autonomyMode(candidate) === AgentAutonomyModes.Decision);
    let changed = false;
    for (const candidate of automatic) {
      changed = this.applyCandidate(input, candidate, leases.get(candidateKey(candidate))) || changed;
    }
    if (decisions.length === 0) return { changed };

    const decisionPort = this.options.decisionPort;
    if (!decisionPort) {
      const error = new Error("World autonomy decision routines require a decision port.");
      input.budget?.defer(this.sourceId);
      for (const candidate of decisions) this.failWork(input, leases.get(candidateKey(candidate)), error);
      throw error;
    }
    const inferenceReservation = input.inferenceBudget?.reserve({
      scope: requireAgentInferenceScope(input.inferenceBudgetScope),
      lane: AgentInferenceLaneIds.Autonomy,
      sourceId: this.sourceId,
      requestId: `world-autonomy:${input.worldId}:${decisions.map(candidateKey).join("|")}`,
      estimatedInputTokens: estimateAgentInferenceTokens({
        worldId: input.worldId,
        now: input.to.toString(),
        snapshot: input.snapshot,
        candidates: decisions.map(toCandidate),
      }),
      priority: decisions.reduce((highest, candidate) => Math.max(highest, candidate.definition.priority), 0),
    });
    if (inferenceReservation && !inferenceReservation.allowed) {
      if (inferenceReservation.retryAtMs === undefined || inferenceReservation.reason === undefined) {
        throw new Error("Inference budget returned a denied decision without retry metadata.");
      }
      const error = new AgentInferenceBudgetExceededError(inferenceReservation.retryAtMs, inferenceReservation.reason);
      input.budget?.defer(this.sourceId);
      for (const candidate of decisions) {
        this.failWork(input, leases.get(candidateKey(candidate)), error, inferenceReservation.retryAtMs);
      }
      return { changed };
    }
    const usageLedger = new AgentModelUsageLedger();
    let usageForSettlement: AgentModelUsageValue | undefined;
    let selected: readonly AgentWorldAutonomySelection[];
    try {
      selected = await withAgentModelUsageLedger(usageLedger, () =>
        decisionPort.select({
          worldId: input.worldId,
          now: input.to,
          snapshot: input.snapshot,
          candidates: decisions.map(toCandidate),
        }),
      );
      usageForSettlement = usageLedger.aggregate();
    } catch (error) {
      usageForSettlement = usageLedger.aggregate();
      if (inferenceReservation?.reservation)
        input.inferenceBudget?.settle({
          reservationId: inferenceReservation.reservation.id,
          ...(usageForSettlement?.inputTokens !== undefined
            ? { actualInputTokens: usageForSettlement.inputTokens }
            : {}),
          ...(usageForSettlement?.outputTokens !== undefined
            ? { actualOutputTokens: usageForSettlement.outputTokens }
            : {}),
        });
      input.budget?.defer(this.sourceId);
      for (const candidate of decisions) this.failWork(input, leases.get(candidateKey(candidate)), error);
      throw error;
    }
    if (inferenceReservation?.reservation) {
      input.inferenceBudget?.settle({
        reservationId: inferenceReservation.reservation.id,
        ...(usageForSettlement?.inputTokens !== undefined ? { actualInputTokens: usageForSettlement.inputTokens } : {}),
        actualOutputTokens: usageForSettlement?.outputTokens ?? estimateAgentInferenceTokens(selected),
      });
    }
    let resolvedSelections: readonly {
      readonly candidate: AgentHabitOccurrenceCandidate;
      readonly disposition: AgentWorldAutonomyDecisionDisposition;
    }[];
    try {
      resolvedSelections = resolveSelections(selected, decisions);
    } catch (error) {
      input.budget?.defer(this.sourceId);
      for (const candidate of decisions) this.failWork(input, leases.get(candidateKey(candidate)), error);
      throw error;
    }
    for (const selection of resolvedSelections) {
      changed =
        (selection.disposition === AgentWorldAutonomyDecisionDispositions.Apply
          ? this.applyCandidate(input, selection.candidate, leases.get(candidateKey(selection.candidate)))
          : this.skipCandidate(input, selection.candidate, leases.get(candidateKey(selection.candidate)))) || changed;
    }
    return { changed };
  }

  private applyCandidate(
    input: AgentWorldWakeInput,
    candidate: AgentHabitOccurrenceCandidate,
    lease: AgentWorldWorkLease | undefined,
  ): boolean {
    try {
      const result = this.options.habits.applyCandidate({
        worldId: input.worldId,
        definitionId: candidate.definition.id,
        occurrenceAt: candidate.occurrenceAt,
        evaluatedAt: input.to,
      });
      this.ackWork(
        input,
        lease,
        { outcome: result.outcome, eventUri: result.eventUri ?? null },
        result.eventUri ? [result.eventUri] : [],
      );
      return result.eventUri !== undefined || result.outcome === "skipped";
    } catch (error) {
      input.budget?.defer(this.sourceId);
      this.failWork(input, lease, error);
      throw error;
    }
  }

  private skipCandidate(
    input: AgentWorldWakeInput,
    candidate: AgentHabitOccurrenceCandidate,
    lease: AgentWorldWorkLease | undefined,
  ): boolean {
    try {
      const result = this.options.habits.skipCandidate({
        worldId: input.worldId,
        definitionId: candidate.definition.id,
        occurrenceAt: candidate.occurrenceAt,
        evaluatedAt: input.to,
        reason: AgentHabitOccurrenceReasons.AutonomyDecisionSkipped,
      });
      this.ackWork(input, lease, { outcome: result.outcome }, []);
      return result.outcome === "skipped";
    } catch (error) {
      input.budget?.defer(this.sourceId);
      this.failWork(input, lease, error);
      throw error;
    }
  }

  private claimWork(
    input: AgentWorldWakeInput,
    candidate: AgentHabitOccurrenceCandidate,
  ): AgentWorldWorkLease | undefined {
    const ledger = this.options.workLedger;
    if (!ledger) return undefined;
    const candidateId = candidateKey(candidate);
    const item = ledger.enqueue({
      worldId: input.worldId,
      sourceId: this.sourceId,
      candidateId,
      requestId: `world-autonomy:${input.worldId}:${candidateId}`,
      payload: {
        worldId: input.worldId,
        routineId: candidate.definition.id,
        occurrenceAt: candidate.occurrenceAt.toString(),
        mode: autonomyMode(candidate),
      },
      nextAttemptAt: input.to,
      now: input.to,
    });
    if (item.status === AgentWorldWorkStatuses.Acknowledged || item.status === AgentWorldWorkStatuses.Cancelled)
      return undefined;
    if (
      item.status === AgentWorldWorkStatuses.Unknown ||
      item.status === AgentWorldWorkStatuses.ReconciliationRequired
    ) {
      throw new Error(`World autonomy work item ${item.id} requires reconciliation before it can run again.`);
    }
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
    if (!this.options.workLedger || !lease) return;
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
    if (!this.options.workLedger || !lease) return;
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
}

function resolveSelections(
  selected: readonly AgentWorldAutonomySelection[],
  decisions: readonly AgentHabitOccurrenceCandidate[],
): readonly {
  readonly candidate: AgentHabitOccurrenceCandidate;
  readonly disposition: AgentWorldAutonomyDecisionDisposition;
}[] {
  if (!Array.isArray(selected) || selected.length !== decisions.length) {
    throw new Error(
      `World autonomy decision must resolve every candidate: expected ${decisions.length}, received ${Array.isArray(selected) ? selected.length : "non-array"}.`,
    );
  }
  const available = new Map(decisions.map((candidate) => [candidateKey(candidate), candidate] as const));
  const selectedKeys = new Set<string>();
  const resolved: Array<{
    readonly candidate: AgentHabitOccurrenceCandidate;
    readonly disposition: AgentWorldAutonomyDecisionDisposition;
  }> = [];
  for (const choice of selected) {
    const routineId = requireSelectionText(choice.routineId, "routine id");
    const occurrenceAt = Temporal.Instant.from(requireSelectionText(choice.occurrenceAt, "occurrence time"));
    const key = `${routineId}\u0000${occurrenceAt.toString()}`;
    if (selectedKeys.has(key)) throw new Error(`World autonomy decision selected a routine more than once: ${key}`);
    selectedKeys.add(key);
    const candidate = available.get(key);
    if (!candidate) throw new Error(`World autonomy decision selected an unknown occurrence: ${key}`);
    if (!Object.values(AgentWorldAutonomyDecisionDispositions).includes(choice.disposition)) {
      throw new Error(`World autonomy decision has an unsupported disposition: ${String(choice.disposition)}`);
    }
    resolved.push({ candidate, disposition: choice.disposition });
  }
  if (selectedKeys.size !== available.size) {
    throw new Error(
      `World autonomy decision did not resolve every candidate: resolved ${selectedKeys.size} of ${available.size}.`,
    );
  }
  return resolved;
}

function assertPositiveMilliseconds(value: number | undefined, label: string): asserts value is number {
  if (value === undefined || !Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer.`);
  }
}

function resolveOwnerId(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : createOpaqueId("world-autonomy-worker");
}

function autonomyMode(candidate: AgentHabitOccurrenceCandidate): AgentAutonomyMode {
  if (candidate.definition.kind !== AgentHabitDefinitionKinds.Autonomy || !candidate.definition.autonomyMode) {
    throw new Error(`Habit ${candidate.definition.id} is not a valid autonomy routine.`);
  }
  return candidate.definition.autonomyMode;
}

function readCandidatePage(
  habits: AgentHabitScheduler,
  input: Parameters<AgentHabitScheduler["listUnprocessedCandidatePage"]>[0],
): AgentHabitOccurrencePage {
  const pageReader = (
    habits as AgentHabitScheduler & {
      readonly listUnprocessedCandidatePage?: AgentHabitScheduler["listUnprocessedCandidatePage"];
    }
  ).listUnprocessedCandidatePage;
  if (pageReader) return pageReader.call(habits, input);
  // Compatibility adapter for embedders compiled before paged recovery was
  // introduced. Production wiring always provides the page reader.
  return {
    candidates: habits.listUnprocessedCandidates(input),
    hasMore: false,
  };
}

function candidateKey(candidate: AgentHabitOccurrenceCandidate): string {
  return `${candidate.definition.id}\u0000${candidate.occurrenceAt.toString()}`;
}

function compareAutonomyCandidates(left: AgentHabitOccurrenceCandidate, right: AgentHabitOccurrenceCandidate): number {
  return (
    right.definition.priority - left.definition.priority ||
    Temporal.Instant.compare(left.occurrenceAt, right.occurrenceAt) ||
    left.definition.id.localeCompare(right.definition.id)
  );
}

function toCandidate(candidate: AgentHabitOccurrenceCandidate): AgentWorldAutonomyCandidate {
  return {
    routineId: candidate.definition.id,
    occurrenceAt: candidate.occurrenceAt.toString(),
    eligibleUntil: candidate.eligibleUntil.toString(),
    summary: candidate.definition.summary,
    actorId: candidate.definition.actor.id,
    priority: candidate.definition.priority,
    mode: autonomyMode(candidate),
  };
}

function requireSelectionText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`World autonomy decision ${label} must be a non-empty string.`);
  }
  return value.trim();
}
