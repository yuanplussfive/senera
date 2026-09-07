import {
  AgentAgendaActorRoles,
  AgentAgendaAuthorities,
  AgentAgendaEventKinds,
  AgentAgendaIntentModes,
  AgentAgendaRecordKinds,
  AgentAgendaStatuses,
  type AgentAgendaActorRole,
  type AgentAgendaAuthority,
  type AgentAgendaCommandEventInput,
  type AgentAgendaEventKind,
  type AgentAgendaHistory,
  type AgentAgendaMutation,
  type AgentAgendaRecord,
  type AgentAgendaRecordKind,
  type AgentAgendaSnapshot,
  type AgentAgendaWriteDisposition,
} from "./AgentAgendaTypes.js";
import { AgentAgendaCommandIdConflictError, AgentAgendaSqliteStore } from "./AgentAgendaSqliteStore.js";
import { createOpaqueId } from "../Core/AgentIds.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import {
  agentGoalCompletionBlockReason,
  agentGoalDependencyCancelReason,
  agentGoalDependencyCompletionReason,
  agentGoalDependencyBlockReason,
  agentGoalDependencyPauseReason,
  assertAgentGoalParent,
  AgentGoalCompletionBlockedError,
} from "./AgentGoalHierarchy.js";

export interface AgentAgendaServiceOptions {
  readonly store: AgentAgendaSqliteStore;
  readonly now?: () => Date;
}

export interface AgentAgendaRecordRequest {
  readonly timeZone: string;
  readonly kind: AgentAgendaRecordKind;
  readonly actor: AgentAgendaActorRole;
  readonly eventKind: AgentAgendaEventKind;
  readonly mutation: Required<Pick<AgentAgendaMutation, "summary" | "status">> & AgentAgendaMutation;
  readonly sourceRefs: readonly string[];
  readonly authority: AgentAgendaAuthority;
  readonly occurredAt?: string;
  readonly idempotencyKey?: string;
}

export interface AgentAgendaEventRequest {
  readonly recordId: string;
  readonly kind: AgentAgendaEventKind;
  readonly mutation: AgentAgendaMutation;
  readonly sourceRefs: readonly string[];
  readonly authority: AgentAgendaAuthority;
  readonly occurredAt?: string;
  readonly idempotencyKey?: string;
}

export type AgentAgendaCommandEventRequest = Omit<
  AgentAgendaCommandEventInput,
  "occurredAt" | "recordedAt" | "idempotencyKey"
> & {
  readonly occurredAt?: string;
};

export interface AgentAgendaMutationResult {
  readonly record: AgentAgendaRecord;
  readonly snapshot: AgentAgendaSnapshot;
  readonly disposition: AgentAgendaWriteDisposition;
}

/** Coordinates one persistent world without treating executions as autonomous goals. */
export class AgentAgendaService {
  constructor(private readonly options: AgentAgendaServiceOptions) {}

  snapshot(timeZone: string, now = this.now()): AgentAgendaSnapshot {
    const world = this.options.store.ensureWorld({ timeZone, now });
    return this.options.store.snapshot(world.id, now);
  }

  history(timeZone: string): AgentAgendaHistory {
    const world = this.options.store.ensureWorld({ timeZone, now: this.now() });
    return this.options.store.history(world.id);
  }

  record(request: AgentAgendaRecordRequest): AgentAgendaMutationResult {
    const now = this.now();
    return this.recordAt(request, now);
  }

  private recordAt(request: AgentAgendaRecordRequest, now: Date): AgentAgendaMutationResult {
    const world = this.options.store.ensureWorld({ timeZone: request.timeZone, now });
    const actor = this.options.store.ensureActor(world.id, request.actor, now);
    const timestamp = request.occurredAt ?? now.toISOString();
    const mutation = normalizeInitialMutation(request.kind, request.mutation, request.authority, now.toISOString());
    assertMutationKind(request.kind, mutation);
    if (mutation.parentGoalId !== undefined) {
      assertAgentGoalParent(this.options.store.snapshot(world.id, now), {
        worldId: world.id,
        parentGoalId: mutation.parentGoalId,
      });
    }
    const { record, receipt } = this.options.store.createRecord({
      worldId: world.id,
      actorId: actor.id,
      kind: request.kind,
      eventKind: request.eventKind,
      mutation,
      sourceRefs: request.sourceRefs,
      authority: request.authority,
      occurredAt: timestamp,
      recordedAt: now.toISOString(),
      idempotencyKey: request.idempotencyKey ?? createOpaqueId("agenda_command"),
    });
    let snapshot = this.options.store.snapshot(world.id, now);
    if (receipt.disposition === "created" && request.kind === AgentAgendaRecordKinds.Goal && mutation.parentGoalId) {
      snapshot = this.reconcileGoalReparenting({
        worldId: world.id,
        goalId: record.id,
        previousParentGoalId: null,
        sourceRefs: request.sourceRefs,
        occurredAt: timestamp,
        rootIdempotencyKey: request.idempotencyKey ?? "",
        snapshot,
      });
    }
    const projected = snapshot.records.find((candidate) => candidate.id === record.id);
    if (!projected) throw new Error(`Agenda record was not projected: ${record.id}`);
    return { record: projected, snapshot, disposition: receipt.disposition };
  }

  evolve(timeZone: string, request: AgentAgendaEventRequest): AgentAgendaMutationResult {
    const now = this.now();
    const world = this.options.store.ensureWorld({ timeZone, now });
    const identity = this.options.store.findRecordIdentity(request.recordId);
    if (!identity || identity.worldId !== world.id)
      throw new Error(`Agenda record is not in the active world: ${request.recordId}`);
    assertMutationKind(identity.kind, request.mutation);
    if (request.mutation.parentGoalId !== undefined) {
      assertAgentGoalParent(this.options.store.snapshot(world.id, now), {
        goalId: identity.id,
        worldId: world.id,
        parentGoalId: request.mutation.parentGoalId,
      });
    }
    const before = this.options.store.snapshot(world.id, now);
    if (identity.kind === AgentAgendaRecordKinds.Goal && request.mutation.status === AgentAgendaStatuses.Completed) {
      const goal = before.records.find((candidate) => candidate.id === identity.id);
      const blockReason = goal && agentGoalCompletionBlockReason(before, goal);
      if (goal && blockReason) throw new AgentGoalCompletionBlockedError(goal.id, blockReason);
    }
    const { receipt } = this.options.store.appendEvent({
      recordId: request.recordId,
      kind: request.kind,
      mutation: request.mutation,
      sourceRefs: request.sourceRefs,
      authority: request.authority,
      occurredAt: request.occurredAt ?? now.toISOString(),
      recordedAt: now.toISOString(),
      idempotencyKey: request.idempotencyKey ?? createOpaqueId("agenda_command"),
    });
    let snapshot = this.options.store.snapshot(world.id, now);
    if (receipt.disposition === "created") {
      snapshot = this.propagateGoalDependencies({
        worldId: world.id,
        sourceGoalId: identity.kind === AgentAgendaRecordKinds.Goal ? identity.id : undefined,
        sourceMutation: request.mutation,
        sourceRefs: request.sourceRefs,
        occurredAt: request.occurredAt ?? now.toISOString(),
        rootIdempotencyKey: request.idempotencyKey ?? "",
        snapshot,
      });
      if (identity.kind === AgentAgendaRecordKinds.Goal && request.mutation.parentGoalId !== undefined) {
        snapshot = this.reconcileGoalReparenting({
          worldId: world.id,
          goalId: identity.id,
          previousParentGoalId: before.records.find((record) => record.id === identity.id)?.parentGoalId ?? null,
          sourceRefs: request.sourceRefs,
          occurredAt: request.occurredAt ?? now.toISOString(),
          rootIdempotencyKey: request.idempotencyKey ?? "",
          snapshot,
        });
      }
      if (request.mutation.status === AgentAgendaStatuses.Completed) {
        snapshot = this.propagateGoalCompletion({
          worldId: world.id,
          sourceGoalId: identity.kind === AgentAgendaRecordKinds.Goal ? identity.id : undefined,
          sourceRefs: request.sourceRefs,
          occurredAt: request.occurredAt ?? now.toISOString(),
          rootIdempotencyKey: request.idempotencyKey ?? "",
          snapshot,
        });
      }
    }
    const record = snapshot.records.find((candidate) => candidate.id === request.recordId);
    if (!record) throw new Error(`Agenda record was not projected: ${request.recordId}`);
    return { record, snapshot, disposition: receipt.disposition };
  }

  executeCommand(timeZone: string, request: AgentAgendaCommandEventRequest): AgentAgendaMutationResult {
    const now = this.now();
    const world = this.options.store.ensureWorld({ timeZone, now });
    const identity = this.options.store.findRecordIdentity(request.recordId);
    if (!identity || identity.worldId !== world.id) {
      throw new Error(`Agenda record is not in the active world: ${request.recordId}`);
    }
    const before = this.options.store.snapshot(world.id, now);
    if (identity.kind === AgentAgendaRecordKinds.Goal && request.mutation.status === AgentAgendaStatuses.Completed) {
      const goal = before.records.find((candidate) => candidate.id === identity.id);
      const blockReason = goal && agentGoalCompletionBlockReason(before, goal);
      if (goal && blockReason) throw new AgentGoalCompletionBlockedError(goal.id, blockReason);
    }
    const { receipt } = this.options.store.appendCommandEvent({
      ...request,
      occurredAt: request.occurredAt ?? now.toISOString(),
      recordedAt: now.toISOString(),
      idempotencyKey: `agenda-goal-command:${request.commandId}`,
    });
    let snapshot = this.options.store.snapshot(world.id, now);
    if (receipt.disposition === "created") {
      snapshot = this.propagateGoalDependencies({
        worldId: world.id,
        sourceGoalId: identity.kind === AgentAgendaRecordKinds.Goal ? identity.id : undefined,
        sourceMutation: request.mutation,
        sourceRefs: request.sourceRefs,
        occurredAt: request.occurredAt ?? now.toISOString(),
        rootIdempotencyKey: `agenda-goal-command:${request.commandId}`,
        snapshot,
      });
      if (identity.kind === AgentAgendaRecordKinds.Goal && request.mutation.parentGoalId !== undefined) {
        snapshot = this.reconcileGoalReparenting({
          worldId: world.id,
          goalId: identity.id,
          previousParentGoalId: before.records.find((record) => record.id === identity.id)?.parentGoalId ?? null,
          sourceRefs: request.sourceRefs,
          occurredAt: request.occurredAt ?? now.toISOString(),
          rootIdempotencyKey: `agenda-goal-command:${request.commandId}`,
          snapshot,
        });
      }
      if (request.mutation.status === AgentAgendaStatuses.Completed) {
        snapshot = this.propagateGoalCompletion({
          worldId: world.id,
          sourceGoalId: identity.kind === AgentAgendaRecordKinds.Goal ? identity.id : undefined,
          sourceRefs: request.sourceRefs,
          occurredAt: request.occurredAt ?? now.toISOString(),
          rootIdempotencyKey: `agenda-goal-command:${request.commandId}`,
          snapshot,
        });
      }
    }
    const record = snapshot.records.find((candidate) => candidate.id === request.recordId);
    if (!record) throw new Error(`Agenda record was not projected: ${request.recordId}`);
    return { record, snapshot, disposition: receipt.disposition };
  }

  replayCommand(
    timeZone: string,
    input: { readonly commandId: string; readonly operationKind: string; readonly payloadHash: string },
  ): AgentAgendaMutationResult | undefined {
    const receipt = this.options.store.commandReceipt(input.commandId);
    if (!receipt) return undefined;
    if (receipt.operationKind !== input.operationKind || receipt.payloadHash !== input.payloadHash) {
      throw new AgentAgendaCommandIdConflictError(
        input.commandId,
        { operationKind: receipt.operationKind, payloadHash: receipt.payloadHash },
        { operationKind: input.operationKind, payloadHash: input.payloadHash },
      );
    }
    const now = this.now();
    const world = this.options.store.ensureWorld({ timeZone, now });
    const snapshot = this.options.store.snapshot(world.id, now);
    const record = snapshot.records.find((candidate) => candidate.id === receipt.recordId);
    if (!record) throw new Error(`Agenda command record was not projected: ${receipt.recordId}`);
    return { record, snapshot, disposition: "idempotent" };
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private propagateGoalDependencies(input: {
    readonly worldId: string;
    readonly sourceGoalId: string | undefined;
    readonly sourceMutation: AgentAgendaMutation;
    readonly sourceRefs: readonly string[];
    readonly occurredAt: string;
    readonly rootIdempotencyKey: string;
    readonly snapshot: AgentAgendaSnapshot;
  }): AgentAgendaSnapshot {
    const sourceGoalId = input.sourceGoalId;
    const status = input.sourceMutation.status;
    const isResume = status === AgentAgendaStatuses.Active && input.sourceMutation.blockedReason === null;
    if (!sourceGoalId || !status) return input.snapshot;
    if (status !== AgentAgendaStatuses.Paused && !isResume && status !== AgentAgendaStatuses.Cancelled) {
      return input.snapshot;
    }
    const descendants = input.snapshot.records
      .filter(
        (record) =>
          record.kind === AgentAgendaRecordKinds.Goal &&
          record.id !== sourceGoalId &&
          isDescendantOf(input.snapshot, record.id, sourceGoalId),
      )
      .sort((left, right) => left.id.localeCompare(right.id));
    const sourceRef = `senera://agenda-dependency/${sha256HexOfCanonicalJson({
      root: input.rootIdempotencyKey,
      sourceGoalId,
      status,
    })}`;
    const pauseReason = agentGoalDependencyPauseReason(sourceGoalId);
    const cancelReason = agentGoalDependencyCancelReason(sourceGoalId);
    for (const child of descendants) {
      const mutation =
        status === AgentAgendaStatuses.Paused &&
        (child.status === AgentAgendaStatuses.Active || child.status === AgentAgendaStatuses.Planned)
          ? {
              status: AgentAgendaStatuses.Paused,
              nextReviewAt: null,
              blockedReason: pauseReason,
              statusReason: "dependency_paused",
            }
          : isResume && child.status === AgentAgendaStatuses.Paused && child.blockedReason === pauseReason
            ? {
                status: AgentAgendaStatuses.Active,
                nextReviewAt: input.occurredAt,
                blockedReason: null,
                statusReason: null,
              }
            : status === AgentAgendaStatuses.Cancelled &&
                child.status !== AgentAgendaStatuses.Completed &&
                child.status !== AgentAgendaStatuses.Cancelled
              ? {
                  status: AgentAgendaStatuses.Cancelled,
                  nextReviewAt: null,
                  blockedReason: null,
                  statusReason: cancelReason,
                }
              : undefined;
      if (!mutation) continue;
      this.options.store.appendEvent({
        recordId: child.id,
        kind:
          mutation.status === AgentAgendaStatuses.Paused
            ? AgentAgendaEventKinds.Paused
            : mutation.status === AgentAgendaStatuses.Cancelled
              ? AgentAgendaEventKinds.Cancelled
              : AgentAgendaEventKinds.Progressed,
        mutation,
        sourceRefs: [...new Set([...input.sourceRefs, sourceRef])],
        authority: AgentAgendaAuthorities.Host,
        occurredAt: input.occurredAt,
        recordedAt: input.occurredAt,
        idempotencyKey: `agenda-dependency:${sha256HexOfCanonicalJson({
          root: input.rootIdempotencyKey,
          sourceGoalId,
          childGoalId: child.id,
          status,
        })}`,
      });
    }
    return this.options.store.snapshot(input.worldId, new Date(input.occurredAt));
  }

  private reconcileGoalReparenting(input: {
    readonly worldId: string;
    readonly goalId: string;
    readonly previousParentGoalId: string | null;
    readonly sourceRefs: readonly string[];
    readonly occurredAt: string;
    readonly rootIdempotencyKey: string;
    readonly snapshot: AgentAgendaSnapshot;
  }): AgentAgendaSnapshot {
    const goal = input.snapshot.records.find((record) => record.id === input.goalId);
    if (!goal || goal.kind !== AgentAgendaRecordKinds.Goal) return input.snapshot;
    const descendants = input.snapshot.records
      .filter(
        (record) =>
          record.kind === AgentAgendaRecordKinds.Goal &&
          record.id !== goal.id &&
          isDescendantOf(input.snapshot, record.id, goal.id),
      )
      .sort((left, right) => left.id.localeCompare(right.id));
    const affected = [goal, ...descendants];
    const parent = goal.parentGoalId
      ? input.snapshot.records.find((record) => record.id === goal.parentGoalId)
      : undefined;
    const pauseReason = parent ? agentGoalDependencyPauseReason(parent.id) : undefined;
    const cancelReason = parent ? agentGoalDependencyCancelReason(parent.id) : undefined;
    const previousPauseReason = input.previousParentGoalId
      ? agentGoalDependencyPauseReason(input.previousParentGoalId)
      : undefined;
    let snapshot = input.snapshot;
    for (const child of affected) {
      const dependencyBlocked = agentGoalDependencyBlockReason(snapshot, child);
      const mutation =
        parent?.status === AgentAgendaStatuses.Cancelled &&
        child.status !== AgentAgendaStatuses.Completed &&
        child.status !== AgentAgendaStatuses.Cancelled
          ? {
              status: AgentAgendaStatuses.Cancelled,
              nextReviewAt: null,
              blockedReason: null,
              statusReason: cancelReason,
            }
          : parent?.status === AgentAgendaStatuses.Paused &&
              (child.status === AgentAgendaStatuses.Active || child.status === AgentAgendaStatuses.Planned)
            ? {
                status: AgentAgendaStatuses.Paused,
                nextReviewAt: null,
                blockedReason: pauseReason,
                statusReason: "dependency_paused",
              }
            : !dependencyBlocked &&
                previousPauseReason !== undefined &&
                child.status === AgentAgendaStatuses.Paused &&
                child.blockedReason === previousPauseReason
              ? {
                  status: AgentAgendaStatuses.Active,
                  nextReviewAt: input.occurredAt,
                  blockedReason: null,
                  statusReason: null,
                }
              : undefined;
      if (!mutation || (mutation.status === child.status && mutation.blockedReason === child.blockedReason)) continue;
      const eventKind =
        mutation.status === AgentAgendaStatuses.Paused
          ? AgentAgendaEventKinds.Paused
          : mutation.status === AgentAgendaStatuses.Cancelled
            ? AgentAgendaEventKinds.Cancelled
            : AgentAgendaEventKinds.Progressed;
      this.options.store.appendEvent({
        recordId: child.id,
        kind: eventKind,
        mutation,
        sourceRefs: [
          ...new Set([
            ...input.sourceRefs,
            `senera://agenda-reparent/${sha256HexOfCanonicalJson({
              root: input.rootIdempotencyKey,
              goalId: input.goalId,
              parentGoalId: goal.parentGoalId,
              childGoalId: child.id,
            })}`,
          ]),
        ],
        authority: AgentAgendaAuthorities.Host,
        occurredAt: input.occurredAt,
        recordedAt: input.occurredAt,
        idempotencyKey: `agenda-reparent-dependency:${sha256HexOfCanonicalJson({
          root: input.rootIdempotencyKey,
          goalId: input.goalId,
          childGoalId: child.id,
          status: mutation.status,
          blockedReason: mutation.blockedReason,
        })}`,
      });
      snapshot = this.options.store.snapshot(input.worldId, new Date(input.occurredAt));
    }
    return snapshot;
  }

  private propagateGoalCompletion(input: {
    readonly worldId: string;
    readonly sourceGoalId: string | undefined;
    readonly sourceRefs: readonly string[];
    readonly occurredAt: string;
    readonly rootIdempotencyKey: string;
    readonly snapshot: AgentAgendaSnapshot;
  }): AgentAgendaSnapshot {
    if (!input.sourceGoalId) return input.snapshot;
    let snapshot = input.snapshot;
    let completedGoalId = input.sourceGoalId;
    let parentId = snapshot.records.find((record) => record.id === completedGoalId)?.parentGoalId ?? null;
    while (parentId) {
      const parent = snapshot.records.find((record) => record.id === parentId);
      if (!parent || parent.kind !== AgentAgendaRecordKinds.Goal) break;
      const blockReason = agentGoalCompletionBlockReason(snapshot, parent);
      if (
        blockReason ||
        parent.status === AgentAgendaStatuses.Paused ||
        parent.status === AgentAgendaStatuses.Cancelled
      )
        break;
      if (parent.status !== AgentAgendaStatuses.Completed) {
        const sourceRef = `senera://agenda-dependency/${sha256HexOfCanonicalJson({
          root: input.rootIdempotencyKey,
          completedGoalId,
          parentGoalId: parent.id,
        })}`;
        this.options.store.appendEvent({
          recordId: parent.id,
          kind: AgentAgendaEventKinds.Finished,
          mutation: {
            status: AgentAgendaStatuses.Completed,
            progress: 1,
            nextReviewAt: null,
            blockedReason: null,
            statusReason: agentGoalDependencyCompletionReason(completedGoalId),
          },
          sourceRefs: [...new Set([...input.sourceRefs, sourceRef])],
          authority: AgentAgendaAuthorities.Host,
          occurredAt: input.occurredAt,
          recordedAt: input.occurredAt,
          idempotencyKey: `agenda-dependency-complete:${sha256HexOfCanonicalJson({
            root: input.rootIdempotencyKey,
            completedGoalId,
            parentGoalId: parent.id,
          })}`,
        });
        snapshot = this.options.store.snapshot(input.worldId, new Date(input.occurredAt));
      }
      completedGoalId = parent.id;
      parentId = snapshot.records.find((record) => record.id === parent.id)?.parentGoalId ?? null;
    }
    return snapshot;
  }
}

function isDescendantOf(snapshot: AgentAgendaSnapshot, goalId: string, ancestorId: string): boolean {
  const records = new Map(snapshot.records.map((record) => [record.id, record] as const));
  const visited = new Set<string>();
  let parentId = records.get(goalId)?.parentGoalId ?? null;
  while (parentId) {
    if (parentId === ancestorId) return true;
    if (visited.has(parentId)) return false;
    visited.add(parentId);
    parentId = records.get(parentId)?.parentGoalId ?? null;
  }
  return false;
}

function normalizeInitialMutation(
  kind: AgentAgendaRecordKind,
  mutation: Required<Pick<AgentAgendaMutation, "summary" | "status">> & AgentAgendaMutation,
  authority: AgentAgendaAuthority,
  now: string,
): Required<Pick<AgentAgendaMutation, "summary" | "status">> & AgentAgendaMutation {
  if (kind !== AgentAgendaRecordKinds.Goal) return mutation;
  return {
    ...mutation,
    intentMode:
      mutation.intentMode ??
      (authority === AgentAgendaAuthorities.UserExplicit
        ? AgentAgendaIntentModes.Committed
        : AgentAgendaIntentModes.Tentative),
    priority: mutation.priority ?? 50,
    progress: mutation.progress ?? 0,
    nextReviewAt: mutation.nextReviewAt !== undefined ? mutation.nextReviewAt : (mutation.dueAt ?? now),
  };
}

export const AgentAgendaSystemAuthority = AgentAgendaAuthorities.Host;
export const AgentAgendaUserAuthority = AgentAgendaAuthorities.UserExplicit;
export const AgentAgendaToolAuthority = AgentAgendaAuthorities.ToolVerified;
export const AgentAgendaUserActor = AgentAgendaActorRoles.User;
export const AgentAgendaResidentActor = AgentAgendaActorRoles.Resident;

const GoalOnlyMutationFields = [
  "intentMode",
  "priority",
  "progress",
  "successCriteria",
  "nextReviewAt",
  "blockedReason",
  "statusReason",
  "parentGoalId",
  "ownerSessionId",
  "lastDecisionKey",
] as const satisfies readonly (keyof AgentAgendaMutation)[];

function assertMutationKind(kind: AgentAgendaRecordKind, mutation: AgentAgendaMutation): void {
  if (kind === AgentAgendaRecordKinds.Goal) return;
  const field = GoalOnlyMutationFields.find((candidate) => mutation[candidate] !== undefined);
  if (field) throw new Error(`Agenda mutation field ${field} is only valid for Goal records.`);
}
