import { projectAgentTextPreview } from "../Text/AgentTextProjection.js";
import {
  AgentChildRunStatuses,
  type AgentChildRunRecord,
  type AgentChildRunSnapshot,
  type AgentChildRunStatus,
} from "./AgentChildRunTypes.js";

/**
 * Small, model-facing view of delegated work. The full child record remains
 * durable and is available through AgentList/AgentWait; this projection only
 * tells the supervisor what it currently owns so it does not repeat work.
 */
export interface AgentDelegationPromptRun {
  readonly runId: string;
  readonly agent: string;
  readonly task: string;
  readonly status: AgentChildRunStatus;
  readonly workItemId?: string;
  readonly taskDigest?: string;
  readonly resultAvailable: boolean;
  readonly resultConsumed: boolean;
  readonly parentWakePending: boolean;
  readonly resources: {
    readonly coverage: "declared" | "unscoped";
    readonly claims: readonly {
      readonly domainId: string;
      readonly identity: string;
      readonly access: "shared" | "exclusive";
    }[];
  };
  readonly joinGroup?: AgentChildRunRecord["joinGroup"];
  readonly progress?: {
    readonly lastActivityAt: string;
    readonly activeTools: readonly string[];
    readonly toolCalls: AgentChildRunSnapshot["toolCalls"];
    readonly checkpointAvailable: boolean;
    readonly artifactCount: number;
    readonly todo?: NonNullable<NonNullable<AgentChildRunSnapshot["control"]>["todo"]>;
  };
}

export interface AgentDelegationPromptContext {
  readonly runs: readonly AgentDelegationPromptRun[];
  readonly counts: {
    readonly total: number;
    readonly active: number;
    readonly awaitingSupervisor: number;
    readonly terminal: number;
    readonly pendingResults: number;
    readonly pendingWakes: number;
  };
}

export const EmptyAgentDelegationPromptContext: AgentDelegationPromptContext = {
  runs: [],
  counts: {
    total: 0,
    active: 0,
    awaitingSupervisor: 0,
    terminal: 0,
    pendingResults: 0,
    pendingWakes: 0,
  },
};

const TerminalStatuses = new Set<AgentChildRunStatus>([
  AgentChildRunStatuses.Completed,
  AgentChildRunStatuses.PartialCompleted,
  AgentChildRunStatuses.Interrupted,
  AgentChildRunStatuses.TimedOut,
  AgentChildRunStatuses.Failed,
  AgentChildRunStatuses.Cancelled,
]);

/** Projects only active or still-unconsumed children into the volatile prompt. */
export function projectAgentDelegationPromptContext(
  records: readonly AgentChildRunRecord[],
): AgentDelegationPromptContext {
  const counts = records.reduce(
    (summary, record) => {
      const terminal = TerminalStatuses.has(record.status);
      summary.total += 1;
      if (terminal) summary.terminal += 1;
      else if (record.status === AgentChildRunStatuses.AwaitingSupervisor) summary.awaitingSupervisor += 1;
      else summary.active += 1;
      if (terminal && record.resultConsumedAt === undefined) summary.pendingResults += 1;
      if (terminal && record.parentWakeConsumed !== true) summary.pendingWakes += 1;
      return summary;
    },
    {
      total: 0,
      active: 0,
      awaitingSupervisor: 0,
      terminal: 0,
      pendingResults: 0,
      pendingWakes: 0,
    },
  );

  const runs = records
    .filter((record) => !TerminalStatuses.has(record.status) || record.resultConsumedAt === undefined)
    .map(projectRun);
  return { runs, counts };
}

function projectRun(record: AgentChildRunRecord): AgentDelegationPromptRun {
  const snapshot = record.snapshot;
  const todo = snapshot?.control?.todo;
  return {
    runId: record.id,
    agent: record.agentName,
    task: projectAgentTextPreview(record.task, 512).text,
    status: record.status,
    ...(record.workItemId ? { workItemId: record.workItemId } : {}),
    ...(record.taskDigest ? { taskDigest: record.taskDigest } : {}),
    resultAvailable: record.finalAnswer !== undefined,
    resultConsumed: record.resultConsumedAt !== undefined,
    parentWakePending: TerminalStatuses.has(record.status) && record.parentWakeConsumed !== true,
    resources: {
      coverage: record.executionContract.resourceCoverage ?? "unscoped",
      claims: record.executionContract.resourceClaims ?? [],
    },
    ...(record.joinGroup ? { joinGroup: record.joinGroup } : {}),
    ...(snapshot
      ? {
          progress: {
            lastActivityAt: snapshot.lastActivityAt,
            activeTools: [...snapshot.activeTools],
            toolCalls: { ...snapshot.toolCalls },
            checkpointAvailable: record.checkpoint !== undefined,
            artifactCount: snapshot.artifactUris.length,
            ...(todo
              ? {
                  todo: {
                    planObserved: todo.planObserved,
                    counts: { ...todo.counts },
                    ...(todo.items ? { items: todo.items.map((item) => ({ ...item })) } : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
  };
}
