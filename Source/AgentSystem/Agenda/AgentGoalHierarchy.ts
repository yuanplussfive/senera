import { AgentBaseError } from "../Core/AgentBaseError.js";
import {
  AgentAgendaRecordKinds,
  AgentAgendaStatuses,
  type AgentAgendaRecord,
  type AgentAgendaSnapshot,
} from "./AgentAgendaTypes.js";

export class AgentGoalParentError extends AgentBaseError {
  readonly code = "agenda_goal_parent_invalid";

  constructor(
    readonly goalId: string | undefined,
    readonly parentGoalId: string,
    message: string,
  ) {
    super(message);
  }
}

export class AgentGoalCompletionBlockedError extends AgentBaseError {
  readonly code = "agenda_goal_completion_blocked";

  constructor(
    readonly goalId: string,
    message: string,
  ) {
    super(message);
  }
}

/** Enforces same-world, Goal-only, acyclic containment for every Agenda writer. */
export function assertAgentGoalParent(
  snapshot: AgentAgendaSnapshot,
  input: {
    readonly goalId?: string;
    readonly worldId: string;
    readonly parentGoalId: string | null;
  },
): void {
  if (input.parentGoalId === null) return;
  const parentId = requireParentId(input.parentGoalId);
  const records = new Map(snapshot.records.map((record) => [record.id, record] as const));
  const parent = records.get(parentId);
  if (!parent || parent.worldId !== input.worldId) {
    throw new AgentGoalParentError(
      input.goalId,
      parentId,
      `Parent Goal does not exist in the active world: ${parentId}`,
    );
  }
  if (parent.kind !== AgentAgendaRecordKinds.Goal) {
    throw new AgentGoalParentError(input.goalId, parentId, `Parent record is not a Goal: ${parentId}`);
  }

  const visited = new Set<string>();
  let cursor: AgentAgendaRecord = parent;
  while (true) {
    if (cursor.id === input.goalId) {
      throw new AgentGoalParentError(input.goalId, parentId, "Goal parent relationship would create a cycle.");
    }
    if (visited.has(cursor.id)) {
      throw new AgentGoalParentError(
        input.goalId,
        parentId,
        `Existing Goal hierarchy contains a cycle at ${cursor.id}.`,
      );
    }
    visited.add(cursor.id);
    if (!cursor.parentGoalId) return;
    const next = records.get(cursor.parentGoalId);
    if (!next || next.kind !== AgentAgendaRecordKinds.Goal || next.worldId !== input.worldId) {
      throw new AgentGoalParentError(
        input.goalId,
        parentId,
        `Existing Goal hierarchy references an invalid parent: ${cursor.parentGoalId}`,
      );
    }
    cursor = next;
  }
}

/** Returns the explicit lifecycle gate inherited from a Goal's parent chain. */
export function agentGoalDependencyBlockReason(
  snapshot: AgentAgendaSnapshot,
  goal: AgentAgendaRecord,
): string | undefined {
  if (!goal.parentGoalId) return undefined;
  assertAgentGoalParent(snapshot, {
    goalId: goal.id,
    worldId: goal.worldId,
    parentGoalId: goal.parentGoalId,
  });
  const records = new Map(snapshot.records.map((record) => [record.id, record] as const));
  let parentId: string | null | undefined = goal.parentGoalId;
  while (parentId) {
    const parent = records.get(parentId);
    if (!parent) throw new AgentGoalParentError(goal.id, parentId, `Parent Goal does not exist: ${parentId}`);
    if (parent.status === AgentAgendaStatuses.Paused || parent.status === AgentAgendaStatuses.Cancelled) {
      return `Parent Goal ${parent.id} is ${parent.status}; child execution is paused.`;
    }
    parentId = parent.parentGoalId;
  }
  return undefined;
}

/** Returns a deterministic reason when a Goal cannot complete before its children. */
export function agentGoalCompletionBlockReason(
  snapshot: AgentAgendaSnapshot,
  goal: AgentAgendaRecord,
): string | undefined {
  if (goal.kind !== AgentAgendaRecordKinds.Goal) return undefined;
  const children = snapshot.records
    .filter((record) => record.kind === AgentAgendaRecordKinds.Goal && record.parentGoalId === goal.id)
    .sort((left, right) => left.id.localeCompare(right.id));
  const incomplete = children.filter((child) => child.status !== AgentAgendaStatuses.Completed);
  if (incomplete.length === 0) return undefined;
  return `Goal ${goal.id} cannot complete while child Goals remain non-completed: ${incomplete
    .map((child) => `${child.id} (${child.status})`)
    .join(", ")}.`;
}

export function agentGoalDependencyPauseReason(parentGoalId: string): string {
  const normalized = requireParentId(parentGoalId);
  return `dependency:paused:${normalized}`;
}

export function agentGoalDependencyCancelReason(parentGoalId: string): string {
  const normalized = requireParentId(parentGoalId);
  return `dependency:cancelled:${normalized}`;
}

export function agentGoalDependencyCompletionReason(parentGoalId: string): string {
  const normalized = requireParentId(parentGoalId);
  return `dependency:completed:${normalized}`;
}

function requireParentId(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new AgentGoalParentError(undefined, value, "Parent Goal id cannot be empty.");
  return normalized;
}
