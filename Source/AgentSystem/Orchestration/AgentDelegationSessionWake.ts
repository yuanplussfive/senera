import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { AgentChildRunRecord, AgentChildRunRepository, AgentChildRunStatus } from "./AgentChildRunTypes.js";
import { AgentChildRunJoinModes, isAgentChildRunBackgroundDeliverable } from "./AgentChildRunTypes.js";
import type {
  AgentSessionBackgroundWakeOutcome,
  AgentSessionBackgroundWakePayload,
} from "../Session/AgentSessionBackgroundWake.js";
import {
  createAgentBackgroundTaskCompletionRequestId,
  createAgentBackgroundTaskJoinRequestId,
  renderAgentBackgroundTaskCompletionInput,
} from "./AgentBackgroundTaskWake.js";

export interface AgentDelegationSessionWakeManager {
  wakeFromBackgroundTask(request: {
    readonly sessionId: string;
    readonly resolve: () => AgentSessionBackgroundWakePayload | undefined;
    readonly acknowledge: (payload: AgentSessionBackgroundWakePayload) => void;
    readonly onEvent?: AgentEventSink;
  }): Promise<AgentSessionBackgroundWakeOutcome>;
}

export interface AgentDelegationSessionWakeOptions {
  readonly childRuns: Pick<AgentChildRunRepository, "get" | "listForJoinGroup" | "markParentResultsDeliveredBatch">;
  readonly sessionManager: AgentDelegationSessionWakeManager;
  readonly onEvent?: AgentEventSink;
}

/**
 * Converts durable detached-run completions into one parent wake per logical
 * task. A parallel spawn batch may finish on different event-loop turns, so a
 * child completion is only a trigger to re-check the persisted join barrier.
 */
export function createAgentDelegationSessionWakeHandler(
  options: AgentDelegationSessionWakeOptions,
): (record: AgentChildRunRecord) => Promise<void> {
  const inFlightRuns = new Map<string, Promise<void>>();

  return async (record) => {
    const current = options.childRuns.get(record.id) ?? record;
    if (!isTerminalDetachedChildRun(current.status, current) || current.parentResultDeliveredAt !== undefined) return;
    if (!hasReadyDelivery(options, current)) return;
    const existing = inFlightRuns.get(current.id);
    if (existing) return existing;
    const wake = wakeParent(options, current).then(() => undefined);
    inFlightRuns.set(current.id, wake);
    try {
      await wake;
    } finally {
      if (inFlightRuns.get(current.id) === wake) inFlightRuns.delete(current.id);
    }
  };
}

async function wakeParent(
  options: AgentDelegationSessionWakeOptions,
  trigger: AgentChildRunRecord,
): Promise<AgentSessionBackgroundWakeOutcome> {
  return options.sessionManager.wakeFromBackgroundTask({
    sessionId: trigger.parentSessionId,
    resolve: () => resolvePendingDelivery(options, trigger),
    acknowledge: ({ childRunIds }) => options.childRuns.markParentResultsDeliveredBatch(childRunIds),
    onEvent: options.onEvent,
  });
}

function resolvePendingDelivery(
  options: AgentDelegationSessionWakeOptions,
  trigger: AgentChildRunRecord,
): AgentSessionBackgroundWakePayload | undefined {
  const current = options.childRuns.get(trigger.id) ?? trigger;
  const group = current.joinGroup;
  const terminal = group
    ? options.childRuns
        .listForJoinGroup(group.id)
        .filter((candidate) => isTerminalDetachedChildRun(candidate.status, candidate))
    : [current].filter((candidate) => isTerminalDetachedChildRun(candidate.status, candidate));
  const members = terminal.filter((candidate) => candidate.parentResultDeliveredAt === undefined);
  if (members.length === 0) return undefined;

  if (group?.mode === AgentChildRunJoinModes.All) {
    const records = options.childRuns.listForJoinGroup(group.id);
    if (records.length < group.expectedCount || terminal.length < group.expectedCount) return undefined;
  }

  const taskId = group?.id ?? current.id;
  const requestId = group
    ? createAgentBackgroundTaskJoinRequestId(group, members)
    : createAgentBackgroundTaskCompletionRequestId(members[0]!);
  return {
    requestId,
    input: renderAgentBackgroundTaskCompletionInput(members),
    approvalMode: members[0]!.approvalMode,
    ...(members[0]!.modelProviderId ? { modelProviderId: members[0]!.modelProviderId } : {}),
    metadata: { backgroundTask: { taskId, runId: taskId } },
    childRunIds: members.map((member) => member.id),
  };
}

function hasReadyDelivery(options: AgentDelegationSessionWakeOptions, trigger: AgentChildRunRecord): boolean {
  const group = trigger.joinGroup;
  if (!group) return true;
  const records = options.childRuns.listForJoinGroup(group.id);
  const terminal = records.filter((candidate) => isTerminalDetachedChildRun(candidate.status, candidate));
  const pending = terminal.filter((candidate) => candidate.parentResultDeliveredAt === undefined);
  return group.mode === AgentChildRunJoinModes.All
    ? records.length >= group.expectedCount && terminal.length >= group.expectedCount
    : pending.length > 0;
}

export function isTerminalDetachedChildRun(status: AgentChildRunStatus, record?: AgentChildRunRecord): boolean {
  if (record && record.launchContract.executionMode !== "detach") return false;
  return isAgentChildRunBackgroundDeliverable(status);
}
