import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { AgentExecutionApprovalMode } from "../Safety/AgentExecutionApprovalMode.js";
import type { AgentChildRunRecord, AgentChildRunRepository, AgentChildRunStatus } from "./AgentChildRunTypes.js";
import { AgentChildRunJoinModes, AgentChildRunStatuses } from "./AgentChildRunTypes.js";
import {
  createAgentBackgroundTaskCompletionRequestId,
  createAgentBackgroundTaskJoinRequestId,
  renderAgentBackgroundTaskCompletionInput,
} from "./AgentBackgroundTaskWake.js";

export interface AgentDelegationSessionWakeManager {
  wakeFromBackgroundTask(request: {
    readonly sessionId: string;
    readonly requestId: string;
    readonly input: string;
    readonly approvalMode: AgentExecutionApprovalMode;
    readonly modelProviderId?: string;
    readonly onEvent?: AgentEventSink;
    readonly metadata?: {
      readonly backgroundTask: {
        readonly taskId: string;
        readonly runId: string;
      };
    };
  }): Promise<"accepted" | "queued" | "missing" | "busy">;
}

export interface AgentDelegationSessionWakeOptions {
  readonly childRuns: Pick<AgentChildRunRepository, "get" | "listForJoinGroup" | "markParentWakeConsumedBatch">;
  readonly sessionManager: AgentDelegationSessionWakeManager;
  readonly onEvent?: AgentEventSink;
}

const TerminalDetachedChildRunStatuses = new Set<AgentChildRunStatus>([
  AgentChildRunStatuses.Completed,
  AgentChildRunStatuses.PartialCompleted,
  AgentChildRunStatuses.Interrupted,
  AgentChildRunStatuses.TimedOut,
  AgentChildRunStatuses.Failed,
  AgentChildRunStatuses.Cancelled,
]);

/**
 * Converts durable detached-run completions into one parent wake per logical
 * task. A parallel spawn batch may finish on different event-loop turns, so a
 * child completion is only a trigger to re-check the persisted join barrier.
 */
export function createAgentDelegationSessionWakeHandler(
  options: AgentDelegationSessionWakeOptions,
): (record: AgentChildRunRecord) => Promise<void> {
  const notifiedJoinGroups = new Map<string, string>();
  const inFlightJoinGroups = new Map<string, Promise<void>>();
  const inFlightRuns = new Map<string, Promise<void>>();

  return async (record) => {
    const current = options.childRuns.get(record.id) ?? record;
    if (current.parentWakeConsumed === true) return;
    const group = record.joinGroup;
    if (!group) {
      const existing = inFlightRuns.get(current.id);
      if (existing) return existing;
      const wake = wakeParent(
        options,
        [current],
        createAgentBackgroundTaskCompletionRequestId(current),
        current.id,
      ).then((outcome) => {
        if (outcome !== "busy") options.childRuns.markParentWakeConsumedBatch([current.id]);
      });
      inFlightRuns.set(current.id, wake);
      try {
        await wake;
      } finally {
        if (inFlightRuns.get(current.id) === wake) inFlightRuns.delete(current.id);
      }
      return;
    }

    const records = options.childRuns.listForJoinGroup(group.id);
    const terminal = records.filter((candidate) => isTerminalDetachedChildRun(candidate.status, candidate));
    const unconsumedTerminal = terminal.filter((candidate) => candidate.parentWakeConsumed !== true);
    const ready =
      group.mode === AgentChildRunJoinModes.All
        ? records.length >= group.expectedCount && terminal.length >= group.expectedCount
        : unconsumedTerminal.length > 0;
    if (!ready) return;

    const signature =
      group.mode === AgentChildRunJoinModes.All
        ? terminal.map((candidate) => `${candidate.id}:${candidate.revision}:${candidate.status}`).join("|")
        : unconsumedTerminal.map((candidate) => `${candidate.id}:${candidate.revision}:${candidate.status}`).join("|");
    if (notifiedJoinGroups.get(group.id) === signature) return;
    const wakeKey = `${group.id}:${signature}`;
    const existing = inFlightJoinGroups.get(wakeKey);
    if (existing) return existing;
    const wakeRecords = group.mode === AgentChildRunJoinModes.Any ? unconsumedTerminal : terminal;
    const wake = wakeParent(
      options,
      wakeRecords,
      createAgentBackgroundTaskJoinRequestId(group, wakeRecords),
      group.id,
    ).then((outcome) => {
      if (outcome !== "busy") {
        const consumed = group.mode === AgentChildRunJoinModes.Any ? unconsumedTerminal : terminal;
        options.childRuns.markParentWakeConsumedBatch(consumed.map((candidate) => candidate.id));
      }
      notifiedJoinGroups.set(group.id, signature);
    });
    inFlightJoinGroups.set(wakeKey, wake);
    try {
      await wake;
    } finally {
      if (inFlightJoinGroups.get(wakeKey) === wake) inFlightJoinGroups.delete(wakeKey);
    }
  };
}

async function wakeParent(
  options: AgentDelegationSessionWakeOptions,
  records: readonly AgentChildRunRecord[],
  requestId: string,
  taskId: string,
): Promise<"accepted" | "queued" | "missing" | "busy"> {
  const first = records[0];
  if (!first) throw new Error("A detached completion wake requires at least one child run.");
  const outcome = await options.sessionManager.wakeFromBackgroundTask({
    sessionId: first.parentSessionId,
    requestId,
    input: renderAgentBackgroundTaskCompletionInput(records),
    approvalMode: first.approvalMode,
    modelProviderId: first.modelProviderId,
    metadata: {
      backgroundTask: {
        taskId,
        runId: taskId,
      },
    },
    onEvent: options.onEvent,
  });
  if (outcome === "missing") {
    return outcome;
  }
  if (outcome === "busy") throw new Error(`Parent session remained busy: ${first.parentSessionId}`);
  return outcome;
}

export function isTerminalDetachedChildRun(status: AgentChildRunStatus, record?: AgentChildRunRecord): boolean {
  if (record && record.launchContract.executionMode !== "detach") return false;
  return TerminalDetachedChildRunStatuses.has(status);
}
