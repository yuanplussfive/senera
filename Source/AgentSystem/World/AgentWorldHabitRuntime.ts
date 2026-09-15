import { Temporal } from "@js-temporal/polyfill";
import { createOpaqueId } from "../Core/AgentIds.js";
import { errorMessage } from "../Core/AgentErrors.js";
import {
  AgentHabitDefinitionKinds,
  type AgentHabitOccurrenceCandidate,
  type AgentHabitScheduler,
} from "./AgentHabitScheduler.js";
import { AgentWorldActionSourceIds } from "./AgentWorldActionBudget.js";
import { AgentWorldWorkLedger, AgentWorldWorkStatuses } from "./AgentWorldWorkLedger.js";
import type {
  AgentWorldScheduleOccurrence,
  AgentWorldWakeInput,
  AgentWorldWakePlan,
  AgentWorldWakeResult,
  AgentWorldWakeSource,
} from "./AgentWorldTypes.js";

/**
 * Adapts deterministic RFC 5545 habits to the same wake and admission
 * protocol used by model-backed World participants.
 */
export class AgentWorldHabitRuntime implements AgentWorldWakeSource {
  readonly sourceId = AgentWorldActionSourceIds.Habit;
  private readonly leaseOwner: string;

  constructor(
    private readonly options: {
      readonly habits: AgentHabitScheduler;
      readonly workLedger?: AgentWorldWorkLedger;
      readonly leaseDurationMs?: number;
      readonly retryDelayMs?: number;
      readonly ownerId?: string;
    },
  ) {
    const configuredOwner = options.ownerId === undefined ? undefined : options.ownerId.trim();
    this.leaseOwner =
      configuredOwner && configuredOwner.length > 0 ? configuredOwner : createOpaqueId("world-habit-worker");
    if (options.workLedger) {
      assertPositiveMilliseconds(options.leaseDurationMs, "World habit work lease duration");
      assertPositiveMilliseconds(options.retryDelayMs, "World habit work retry delay");
    }
  }

  wakePlan(input: { readonly worldId: string; readonly after: Temporal.Instant }): AgentWorldWakePlan {
    return this.options.habits.evaluationWakePlan(input.worldId, input.after, AgentHabitDefinitionKinds.Habit);
  }

  upcomingSchedules(input: {
    readonly worldId: string;
    readonly after: Temporal.Instant;
  }): readonly AgentWorldScheduleOccurrence[] {
    return this.options.habits.upcoming(input.worldId, input.after, AgentHabitDefinitionKinds.Habit);
  }

  onWake(input: AgentWorldWakeInput): AgentWorldWakeResult {
    if (!input.budget) {
      throw new Error("World habit wake requires the shared action budget.");
    }

    // Read one candidate beyond the remaining action capacity. That extra
    // candidate makes budget exhaustion explicit and schedules a retry without
    // requiring a second, hidden catch-up limit.
    const page = this.options.habits.listUnprocessedCandidatePage({
      worldId: input.worldId,
      to: input.to,
      maximumOccurrences: Math.max(1, input.budget.remainingActions + 1),
      definitionKind: AgentHabitDefinitionKinds.Habit,
    });
    let changed = false;
    for (const candidate of page.candidates) {
      const admission = input.budget.admit({
        sourceId: this.sourceId,
        candidateId: candidateKey(candidate),
        kind: "action",
        priority: candidate.definition.priority,
        conflictKeys: habitConflictKeys(candidate),
      });
      if (!admission.admitted) continue;
      changed = this.applyCandidate(input, candidate) || changed;
    }
    if (page.hasMore) input.budget.defer(this.sourceId);
    return { changed };
  }

  private applyCandidate(input: AgentWorldWakeInput, candidate: AgentHabitOccurrenceCandidate): boolean {
    const ledger = this.options.workLedger;
    if (!ledger) {
      const result = this.options.habits.applyCandidate({
        worldId: input.worldId,
        definitionId: candidate.definition.id,
        occurrenceAt: candidate.occurrenceAt,
        evaluatedAt: input.to,
      });
      return result.eventUri !== undefined || result.outcome === "skipped";
    }
    const candidateId = candidateKey(candidate);
    const requestId = `world-habit:${input.worldId}:${candidateId}`;
    const item = ledger.enqueue({
      worldId: input.worldId,
      sourceId: this.sourceId,
      candidateId,
      requestId,
      payload: {
        worldId: input.worldId,
        definitionId: candidate.definition.id,
        occurrenceAt: candidate.occurrenceAt.toString(),
        evaluatedAt: input.to.toString(),
      },
      nextAttemptAt: input.to,
      now: input.to,
    });
    if (item.status === AgentWorldWorkStatuses.Acknowledged || item.status === AgentWorldWorkStatuses.Cancelled) {
      return false;
    }
    if (
      item.status === AgentWorldWorkStatuses.Unknown ||
      item.status === AgentWorldWorkStatuses.ReconciliationRequired
    ) {
      throw new Error(`World habit work item ${item.id} requires reconciliation before it can run again.`);
    }
    const lease = ledger.claim({
      id: item.id,
      owner: this.leaseOwner,
      now: input.to,
      leaseUntil: input.to.add({ milliseconds: this.options.leaseDurationMs! }),
    });
    if (!lease) return false;
    ledger.markRunning({ id: item.id, owner: this.leaseOwner, generation: lease.generation, now: input.to });
    try {
      const result = this.options.habits.applyCandidate({
        worldId: input.worldId,
        definitionId: candidate.definition.id,
        occurrenceAt: candidate.occurrenceAt,
        evaluatedAt: input.to,
      });
      ledger.ack({
        id: item.id,
        owner: this.leaseOwner,
        generation: lease.generation,
        now: input.to,
        result: { outcome: result.outcome, eventUri: result.eventUri ?? null },
        evidenceRefs: result.eventUri ? [result.eventUri] : [],
      });
      return result.eventUri !== undefined || result.outcome === "skipped";
    } catch (error) {
      input.budget?.defer(this.sourceId);
      ledger.fail({
        id: item.id,
        owner: this.leaseOwner,
        generation: lease.generation,
        now: input.to,
        error: errorMessage(error),
        nextAttemptAt: input.to.add({ milliseconds: this.options.retryDelayMs! }),
      });
      throw error;
    }
  }
}

function assertPositiveMilliseconds(value: number | undefined, label: string): asserts value is number {
  if (value === undefined || !Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer.`);
  }
}

function candidateKey(candidate: AgentHabitOccurrenceCandidate): string {
  return `${candidate.definition.id}\u0000${candidate.occurrenceAt.toString()}`;
}

function habitConflictKeys(candidate: AgentHabitOccurrenceCandidate): string[] {
  const keys = new Set<string>([`entity:${candidate.definition.actor.id}`]);
  if (candidate.definition.stateTransition) {
    keys.add(`state:${candidate.definition.actor.id}:${candidate.definition.stateTransition.machineId}`);
  }
  for (const effect of candidate.definition.effects) {
    switch (effect.kind) {
      case "entity_upsert":
      case "entity_replace":
        keys.add(`entity:${effect.entity.id}`);
        break;
      case "entity_patch":
      case "entity_retire":
        keys.add(`entity:${effect.entityId}`);
        break;
      case "relation_assert":
        keys.add(`entity:${effect.subject.id}`);
        keys.add(`entity:${effect.object.id}`);
        break;
      case "relation_retract":
        keys.add(`entity:${effect.subjectId}`);
        keys.add(`entity:${effect.objectId}`);
        break;
      case "state_transition":
        keys.add(`state:${effect.actorId}:${effect.machineId}`);
        break;
      case "state_machine_initialized":
        keys.add(`state:${effect.actorId}:${effect.machineId}`);
        break;
      case "clock_advance":
        keys.add("world:clock");
        break;
    }
  }
  return [...keys].sort();
}
