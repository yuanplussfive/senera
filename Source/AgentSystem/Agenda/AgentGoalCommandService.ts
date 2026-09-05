import { Temporal } from "@js-temporal/polyfill";
import { AgentBaseError } from "../Core/AgentBaseError.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { AgentAgendaService, type AgentAgendaMutationResult } from "./AgentAgendaService.js";
import { agentGoalDependencyBlockReason, assertAgentGoalParent } from "./AgentGoalHierarchy.js";
import {
  AgentAgendaAuthorities,
  AgentAgendaEventKinds,
  AgentAgendaIntentModes,
  AgentAgendaRecordKinds,
  AgentAgendaStatuses,
  type AgentAgendaEventKind,
  type AgentAgendaMutation,
  type AgentAgendaRecord,
  type AgentAgendaSnapshot,
} from "./AgentAgendaTypes.js";

export type AgentGoalCommand =
  | AgentGoalCommitCommand
  | AgentGoalPauseCommand
  | AgentGoalResumeCommand
  | AgentGoalCancelCommand
  | AgentGoalReparentCommand;

interface AgentGoalCommandBase {
  readonly commandId: string;
  readonly goalId: string;
  readonly expectedRevision: number;
}

export interface AgentGoalCommitCommand extends AgentGoalCommandBase {
  readonly operation: "commit";
}

export interface AgentGoalPauseCommand extends AgentGoalCommandBase {
  readonly operation: "pause";
  readonly reason?: string;
}

export interface AgentGoalResumeCommand extends AgentGoalCommandBase {
  readonly operation: "resume";
  readonly nextReviewAt?: string;
}

export interface AgentGoalCancelCommand extends AgentGoalCommandBase {
  readonly operation: "cancel";
  readonly reason?: string;
}

export interface AgentGoalReparentCommand extends AgentGoalCommandBase {
  readonly operation: "reparent";
  readonly parentGoalId: string | null;
}

export interface AgentGoalCommandServiceOptions {
  readonly agenda: AgentAgendaService;
  readonly timeZone: () => string;
  readonly reviewDelayMs: () => number;
  readonly now?: () => Date;
}

export class AgentGoalCommandTargetError extends AgentBaseError {
  readonly code = "agenda_goal_command_target_invalid";

  constructor(
    readonly goalId: string,
    message: string,
  ) {
    super(message);
  }
}

export class AgentGoalCommandTransitionError extends AgentBaseError {
  readonly code = "agenda_goal_command_transition_invalid";

  constructor(
    readonly goalId: string,
    readonly operation: AgentGoalCommand["operation"],
    readonly status: string,
    message: string,
  ) {
    super(message);
  }
}

export { AgentGoalParentError } from "./AgentGoalHierarchy.js";

export class AgentGoalCommandInputError extends AgentBaseError {
  readonly code = "agenda_goal_command_input_invalid";
}

/** Applies explicit operator commands to Goal records with durable replay and OCC. */
export class AgentGoalCommandService {
  constructor(private readonly options: AgentGoalCommandServiceOptions) {}

  execute(command: AgentGoalCommand): AgentAgendaMutationResult {
    const normalized = normalizeCommand(command);
    const descriptor = describeCommand(normalized);
    const timeZone = this.options.timeZone();
    const replayed = this.options.agenda.replayCommand(timeZone, descriptor);
    if (replayed) return replayed;

    const now = this.options.now?.() ?? new Date();
    const snapshot = this.options.agenda.snapshot(timeZone, now);
    const goal = requireGoal(snapshot, normalized.goalId);
    const transition = this.compileTransition(normalized, goal, snapshot, now);
    return this.options.agenda.executeCommand(timeZone, {
      recordId: goal.id,
      kind: transition.kind,
      mutation: transition.mutation,
      sourceRefs: [commandSourceRef(normalized.commandId)],
      authority: AgentAgendaAuthorities.UserExplicit,
      commandId: normalized.commandId,
      operationKind: descriptor.operationKind,
      payloadHash: descriptor.payloadHash,
      expectedRevision: normalized.expectedRevision,
      occurredAt: now.toISOString(),
    });
  }

  private compileTransition(
    command: AgentGoalCommand,
    goal: AgentAgendaRecord,
    snapshot: AgentAgendaSnapshot,
    now: Date,
  ): { readonly kind: AgentAgendaEventKind; readonly mutation: AgentAgendaMutation } {
    switch (command.operation) {
      case "commit":
        assertNotTerminal(goal, command.operation);
        if (goal.intentMode === AgentAgendaIntentModes.Committed) {
          throw transitionError(goal, command.operation, "Goal is already committed.");
        }
        return {
          kind: AgentAgendaEventKinds.Progressed,
          mutation: { intentMode: AgentAgendaIntentModes.Committed, statusReason: null },
        };
      case "pause":
        if (goal.status !== AgentAgendaStatuses.Active) {
          throw transitionError(goal, command.operation, "Only an active Goal can be paused.");
        }
        return {
          kind: AgentAgendaEventKinds.Paused,
          mutation: {
            status: AgentAgendaStatuses.Paused,
            nextReviewAt: null,
            statusReason: normalizeOptionalText(command.reason, "Goal pause reason"),
          },
        };
      case "resume": {
        if (goal.status !== AgentAgendaStatuses.Paused) {
          throw transitionError(goal, command.operation, "Only a paused Goal can be resumed.");
        }
        const dependencyReason = agentGoalDependencyBlockReason(snapshot, goal);
        if (dependencyReason) {
          throw transitionError(
            goal,
            command.operation,
            `Goal cannot resume while a parent dependency is active: ${dependencyReason}`,
          );
        }
        return {
          kind: AgentAgendaEventKinds.Progressed,
          mutation: {
            status: AgentAgendaStatuses.Active,
            nextReviewAt: resolveNextReviewAt(command.nextReviewAt, now, this.options.reviewDelayMs()),
            blockedReason: null,
            statusReason: null,
          },
        };
      }
      case "cancel":
        assertNotTerminal(goal, command.operation);
        return {
          kind: AgentAgendaEventKinds.Cancelled,
          mutation: {
            status: AgentAgendaStatuses.Cancelled,
            nextReviewAt: null,
            blockedReason: null,
            statusReason: normalizeOptionalText(command.reason, "Goal cancellation reason"),
          },
        };
      case "reparent":
        if (goal.parentGoalId === command.parentGoalId) {
          throw transitionError(goal, command.operation, "Goal already has the requested parent.");
        }
        assertAgentGoalParent(snapshot, {
          goalId: goal.id,
          worldId: goal.worldId,
          parentGoalId: command.parentGoalId,
        });
        return {
          kind: AgentAgendaEventKinds.Progressed,
          mutation: { parentGoalId: command.parentGoalId },
        };
    }
  }
}

function normalizeCommand(command: AgentGoalCommand): AgentGoalCommand {
  const base = {
    commandId: requireText(command.commandId, "Goal command id"),
    goalId: requireText(command.goalId, "Goal id"),
    expectedRevision: requirePositiveRevision(command.expectedRevision),
  };
  switch (command.operation) {
    case "commit":
      return { ...base, operation: command.operation };
    case "pause":
    case "cancel":
      return {
        ...base,
        operation: command.operation,
        ...(command.reason !== undefined ? { reason: requireText(command.reason, "Goal command reason") } : {}),
      };
    case "resume":
      return {
        ...base,
        operation: command.operation,
        ...(command.nextReviewAt !== undefined
          ? { nextReviewAt: parseInstant(command.nextReviewAt, "Goal next review time").toString() }
          : {}),
      };
    case "reparent":
      return {
        ...base,
        operation: command.operation,
        parentGoalId: command.parentGoalId === null ? null : requireText(command.parentGoalId, "Parent Goal id"),
      };
  }
}

function describeCommand(command: AgentGoalCommand): {
  readonly commandId: string;
  readonly operationKind: string;
  readonly payloadHash: string;
} {
  const operationKind = `agenda.goal.${command.operation}`;
  return {
    commandId: requireText(command.commandId, "Goal command id"),
    operationKind,
    payloadHash: sha256HexOfCanonicalJson({ version: 1, operationKind, ...command, commandId: undefined }),
  };
}

function requireGoal(snapshot: AgentAgendaSnapshot, goalId: string): AgentAgendaRecord {
  const id = requireText(goalId, "Goal id");
  const record = snapshot.records.find((candidate) => candidate.id === id);
  if (!record) throw new AgentGoalCommandTargetError(id, `Goal does not exist in the active world: ${id}`);
  if (record.kind !== AgentAgendaRecordKinds.Goal) {
    throw new AgentGoalCommandTargetError(id, `Agenda record is not a Goal: ${id}`);
  }
  return record;
}

function assertNotTerminal(goal: AgentAgendaRecord, operation: AgentGoalCommand["operation"]): void {
  if (goal.status === AgentAgendaStatuses.Completed || goal.status === AgentAgendaStatuses.Cancelled) {
    throw transitionError(goal, operation, `A terminal Goal cannot accept operation ${operation}.`);
  }
}

function transitionError(
  goal: AgentAgendaRecord,
  operation: AgentGoalCommand["operation"],
  message: string,
): AgentGoalCommandTransitionError {
  return new AgentGoalCommandTransitionError(goal.id, operation, goal.status, message);
}

function resolveNextReviewAt(value: string | undefined, now: Date, reviewDelayMs: number): string {
  const nowInstant = Temporal.Instant.from(now.toISOString());
  if (value !== undefined) {
    const instant = parseInstant(value, "Goal next review time");
    if (Temporal.Instant.compare(instant, nowInstant) < 0) {
      throw new AgentGoalCommandInputError("Goal next review time cannot be in the past.");
    }
    return instant.toString();
  }
  if (!Number.isSafeInteger(reviewDelayMs) || reviewDelayMs <= 0) {
    throw new Error("Goal review delay must be a positive safe integer in milliseconds.");
  }
  return nowInstant.add({ milliseconds: reviewDelayMs }).toString();
}

function parseInstant(value: string, label: string): Temporal.Instant {
  try {
    return Temporal.Instant.from(requireText(value, label));
  } catch (error) {
    throw new AgentGoalCommandInputError(`${label} must use an ISO timestamp with an explicit offset.`, {
      cause: error,
    });
  }
}

function normalizeOptionalText(value: string | undefined, label: string): string | null {
  return value === undefined ? null : requireText(value, label);
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new AgentGoalCommandInputError(`${label} cannot be empty.`);
  return normalized;
}

function requirePositiveRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new AgentGoalCommandInputError("Goal expected revision must be a positive safe integer.");
  }
  return value;
}

function commandSourceRef(commandId: string): string {
  return `senera://agenda-goal-command/${encodeURIComponent(requireText(commandId, "Goal command id"))}`;
}
