import type { AgentEventSink } from "../Events/AgentEvent.js";
import { emitAgentEvent } from "../Events/AgentEvent.js";
import type { AgentPiToolPlanState } from "../PiShared/AgentPiPlanningTypes.js";
import { AgentExecutionLedgerSqliteStore } from "./AgentExecutionLedgerSqliteStore.js";
import {
  type AgentExecutionEventRecord,
  type AgentExecutionLedger,
  type AgentExecutionLedgerSnapshot,
  type AgentExecutionPlanSyncInput,
  type AgentExecutionPromptContext,
  type AgentExecutionSyncResult,
} from "./AgentExecutionLedgerTypes.js";

const NativeObservedPlanId = "native-observed";

export interface AgentExecutionObservedToolInput {
  readonly sessionId: string;
  readonly requestId: string;
  readonly objective: string;
  readonly toolName: string;
  readonly callId: string;
  readonly purpose: string;
  readonly status: "dispatched" | "completed" | "failed";
  readonly failure?: string;
}

export interface AgentExecutionLedgerServiceOptions {
  readonly store: AgentExecutionLedgerSqliteStore;
}

/** Coordinates one-request execution state without deriving durable intent from tool activity. */
export class AgentExecutionLedgerService {
  constructor(private readonly options: AgentExecutionLedgerServiceOptions) {}

  snapshot(sessionId: string): AgentExecutionLedgerSnapshot {
    return this.options.store.snapshot(sessionId);
  }

  find(sessionId: string, requestId: string): AgentExecutionLedger | undefined {
    return this.options.store.find(sessionId, requestId);
  }

  promptContext(sessionId?: string): AgentExecutionPromptContext {
    if (!sessionId?.trim()) return { active: null, executions: [] };
    const snapshot = this.snapshot(sessionId);
    // The prompt receives only the unresolved execution. Completed request history
    // remains queryable through snapshot() and event history, but must not grow the
    // next turn's context indefinitely.
    return {
      active: snapshot.active,
      executions: snapshot.active ? [snapshot.active] : [],
    };
  }

  syncPlan(input: AgentExecutionPlanSyncInput): AgentExecutionSyncResult {
    return this.sync(input);
  }

  async emitObservedTool(
    input: AgentExecutionObservedToolInput,
    onEvent?: AgentEventSink,
  ): Promise<AgentExecutionLedger> {
    const current = this.options.store
      .snapshot(input.sessionId)
      .executions.find((execution) => execution.requestId === input.requestId);
    const nodes =
      current?.steps.map((step) => ({
        nodeId: step.nodeId,
        planIndex: step.index,
        toolName: step.title,
        purpose: step.detail,
        dependencyNodeIds: [...step.dependencyIds],
        status: projectObservedStatus(step.status),
        ...(step.callId ? { callId: step.callId } : {}),
        ...(step.failure ? { failure: step.failure } : {}),
      })) ?? [];
    const nodeId = `observed:${input.callId}`;
    const existingIndex = nodes.findIndex((node) => node.nodeId === nodeId);
    const nextNode = {
      nodeId,
      planIndex: existingIndex >= 0 ? nodes[existingIndex].planIndex : nodes.length,
      toolName: input.toolName,
      purpose: input.purpose,
      dependencyNodeIds: [],
      status: input.status,
      callId: input.callId,
      ...(input.failure ? { failure: input.failure } : {}),
    } satisfies AgentPiToolPlanState["revisions"][number]["nodes"][number];
    const planState: AgentPiToolPlanState = {
      revisions: [
        {
          planId: NativeObservedPlanId,
          revision: 1,
          nodes:
            existingIndex >= 0 ? nodes.map((node) => (node.nodeId === nodeId ? nextNode : node)) : [...nodes, nextNode],
        },
      ],
    };
    const result = this.sync({
      sessionId: input.sessionId,
      requestId: input.requestId,
      objective: input.objective,
      planState,
      completion: "deferred",
    });
    if (onEvent) {
      await this.emitSynchronized(result, input.sessionId, input.requestId, onEvent);
    }
    return result.snapshot.executions.find((execution) => execution.requestId === input.requestId)!;
  }

  async emitPlanSync(
    input: AgentExecutionPlanSyncInput,
    onEvent: AgentEventSink,
  ): Promise<AgentExecutionLedgerSnapshot> {
    const result = this.sync(input);
    await this.emitSynchronized(result, input.sessionId, input.requestId, onEvent);
    return result.snapshot;
  }

  async finalizeExecution(
    sessionId: string,
    requestId: string,
    onEvent?: AgentEventSink,
  ): Promise<AgentExecutionLedgerSnapshot> {
    const result = this.options.store.finalize(sessionId, requestId);
    if (onEvent) {
      await this.emitSynchronized(result, sessionId, requestId, onEvent);
    }
    return result.snapshot;
  }

  private sync(input: AgentExecutionPlanSyncInput): AgentExecutionSyncResult {
    return this.options.store.syncPlan(input);
  }

  private async emitSynchronized(
    result: AgentExecutionSyncResult,
    sessionId: string,
    requestId: string,
    onEvent: AgentEventSink,
  ): Promise<void> {
    for (const event of result.events) {
      await emitAgentEvent(onEvent, projectExecutionEvent(event, sessionId, requestId, result.snapshot));
    }
  }
}

function projectObservedStatus(
  status: AgentExecutionLedger["steps"][number]["status"],
): "planned" | "dispatched" | "completed" | "failed" | "blocked" {
  switch (status) {
    case "planned":
      return "planned";
    case "running":
      return "dispatched";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "blocked":
      return "blocked";
  }
}

function projectExecutionEvent(
  event: AgentExecutionEventRecord,
  sessionId: string,
  requestId: string,
  snapshot: AgentExecutionLedgerSnapshot,
) {
  return {
    kind: event.kind,
    context: { sessionId, requestId },
    data: {
      snapshot,
      execution: event.execution,
      ...(event.step ? { step: event.step } : {}),
    },
  } as const;
}

export type { AgentExecutionLedgerSnapshot };
