import { AgentCancellationError, readAbortMessage, throwIfAborted } from "../Core/AgentCancellation.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { createOpaqueId } from "../Core/AgentIds.js";
import { AgentEventKinds, emitAgentEvent, type AgentDomainEvent, type AgentEventSink } from "../Events/AgentEvent.js";
import { AgentChildRunStatuses, type AgentChildRunRecord, type AgentChildRunStatus } from "./AgentChildRunTypes.js";
import {
  AgentDelegationExecutionModes,
  type AgentDelegationRequest,
  type AgentDelegationContext,
} from "./AgentDelegationService.js";
import type { AgentOrchestrationEventRelay } from "./AgentOrchestrationEventRelay.js";
import type { AgentWorkflowDomainEvent, AgentWorkflowEventKind } from "./AgentOrchestrationEventTypes.js";
import {
  AgentWorkflowFailurePolicies,
  AgentWorkflowHandoffModes,
  AgentWorkflowNodeStatuses,
  AgentWorkflowStatuses,
  parseAgentWorkflowDefinition,
  type AgentWorkflowNodeDefinition,
  type AgentWorkflowNodeStatus,
  type AgentWorkflowRecord,
  type AgentWorkflowRepository,
  type AgentWorkflowResult,
  type AgentWorkflowStatus,
} from "./AgentWorkflowTypes.js";

export const AgentWorkflowExecutionModes = {
  Wait: "wait",
  Detach: "detach",
} as const;

export type AgentWorkflowExecutionMode = (typeof AgentWorkflowExecutionModes)[keyof typeof AgentWorkflowExecutionModes];

export interface AgentWorkflowServiceOptions {
  readonly repository: AgentWorkflowRepository;
  readonly delegation: AgentWorkflowDelegationPort;
  readonly events: AgentOrchestrationEventRelay;
  readonly maxNodes: () => number | null | undefined;
}

export interface AgentWorkflowDelegationPort {
  delegate(request: AgentDelegationRequest, context: AgentDelegationContext): Promise<AgentChildRunRecord>;
  get(id: string, parentSessionId: string): AgentChildRunRecord | undefined;
  listForOwner(ownerRunId: string): AgentChildRunRecord[];
  wait(id: string, parentSessionId: string, signal?: AbortSignal): Promise<AgentChildRunRecord | undefined>;
  cancel(id: string, parentSessionId: string, onEvent?: AgentEventSink): Promise<AgentChildRunRecord | undefined>;
  resume(
    id: string,
    parentSessionId: string,
    message: string | undefined,
    context: AgentDelegationContext,
  ): Promise<AgentChildRunRecord | undefined>;
}

interface ActiveWorkflow {
  readonly controller: AbortController;
  readonly onEvent?: AgentEventSink;
  promise: Promise<AgentWorkflowRecord>;
  termination?: "cancel" | "shutdown";
}

export class AgentWorkflowService {
  private readonly active = new Map<string, ActiveWorkflow>();
  private acceptingWork = true;
  private shutdownPromise?: Promise<void>;

  constructor(private readonly options: AgentWorkflowServiceOptions) {
    this.options.repository.recoverInterrupted("Senera restarted before the subagent workflow completed.");
  }

  async start(
    definitionInput: unknown,
    executionMode: AgentWorkflowExecutionMode,
    context: AgentDelegationContext,
  ): Promise<AgentWorkflowRecord> {
    this.assertAcceptingWork();
    throwIfAborted(context.signal);
    const definition = parseAgentWorkflowDefinition(definitionInput);
    const maxNodes = this.options.maxNodes();
    if (maxNodes != null && definition.nodes.length > maxNodes) {
      throw new Error(
        `Subagent workflow contains ${definition.nodes.length} nodes; configured maximum is ${maxNodes}.`,
      );
    }
    const id = createOpaqueId("workflow");
    const record = this.options.repository.create({
      id,
      parentSessionId: context.parentSessionId,
      parentRequestId: context.parentRequestId,
      approvalMode: context.approvalMode,
      definitionDigest: sha256HexOfCanonicalJson(definition),
      definition,
    });
    const completion = this.startExecution(record, context);
    return executionMode === AgentWorkflowExecutionModes.Detach ? record : completion;
  }

  get(id: string, parentSessionId: string): AgentWorkflowRecord | undefined {
    const record = this.options.repository.get(id);
    return record?.parentSessionId === parentSessionId ? record : undefined;
  }

  list(parentSessionId: string, parentRequestId?: string): AgentWorkflowRecord[] {
    return this.options.repository.listForParent(parentSessionId, parentRequestId);
  }

  projectResult(workflow: AgentWorkflowRecord | undefined): AgentWorkflowResult {
    if (!workflow) return { workflow: null, results: [] };
    const childByNode = new Map(
      this.options.delegation.listForOwner(workflow.id).map((child) => [child.nodeId, child] as const),
    );
    return {
      workflow,
      results: workflow.nodes.map((node) => {
        const child = childByNode.get(node.nodeId);
        const error = node.error ?? child?.error;
        return {
          nodeId: node.nodeId,
          status: node.status,
          ...(node.childRunId ? { childRunId: node.childRunId } : {}),
          ...(child?.finalAnswer !== undefined ? { finalAnswer: child.finalAnswer } : {}),
          ...(error !== undefined ? { error } : {}),
        };
      }),
    };
  }

  wait(id: string, parentSessionId: string, signal?: AbortSignal): Promise<AgentWorkflowRecord | undefined> {
    const record = this.get(id, parentSessionId);
    if (!record) return Promise.resolve(undefined);
    const active = this.active.get(id);
    return active ? waitWithSignal(active.promise, signal) : Promise.resolve(record);
  }

  async cancel(
    id: string,
    parentSessionId: string,
    onEvent?: AgentEventSink,
  ): Promise<AgentWorkflowRecord | undefined> {
    const record = this.get(id, parentSessionId);
    if (!record) return undefined;
    const active = this.active.get(id);
    if (!active) {
      const cancelling = this.options.repository.markCancelling(id);
      if (cancelling) await this.emit(onEvent, workflowEvent(AgentEventKinds.WorkflowCancelling, cancelling));
      const cancelled = this.options.repository.markCancelled(id) ?? record;
      await this.emit(onEvent, workflowEvent(AgentEventKinds.WorkflowCancelled, cancelled));
      return cancelled;
    }
    if (!active.termination) active.termination = "cancel";
    const cancelling = this.options.repository.markCancelling(id);
    if (cancelling) await this.emit(onEvent, workflowEvent(AgentEventKinds.WorkflowCancelling, cancelling));
    active.controller.abort(new AgentCancellationError("Subagent workflow cancelled by its parent."));
    await Promise.allSettled(
      record.nodes
        .filter((node) => node.status === AgentWorkflowNodeStatuses.Running && node.childRunId)
        .map((node) => this.options.delegation.cancel(node.childRunId!, parentSessionId, onEvent)),
    );
    return active.promise;
  }

  resume(
    id: string,
    parentSessionId: string,
    context: AgentDelegationContext,
  ): Promise<AgentWorkflowRecord | undefined> {
    const record = this.get(id, parentSessionId);
    if (!record) return Promise.resolve(undefined);
    if (this.active.has(id)) throw new Error(`Subagent workflow ${id} is already active.`);
    if (
      !isWorkflowStatus(record.status, [
        AgentWorkflowStatuses.Paused,
        AgentWorkflowStatuses.PartialCompleted,
        AgentWorkflowStatuses.Failed,
      ])
    ) {
      throw new Error(`Subagent workflow ${id} cannot be resumed from ${record.status}.`);
    }
    const reset = this.options.repository.resetForResume(id);
    if (!reset) return Promise.resolve(this.get(id, parentSessionId));
    return this.startExecution(reset, context);
  }

  snapshot(): { readonly activeWorkflowIds: readonly string[] } {
    return { activeWorkflowIds: [...this.active.keys()] };
  }

  shutdown(): Promise<void> {
    this.acceptingWork = false;
    return (this.shutdownPromise ??= this.stop());
  }

  private startExecution(record: AgentWorkflowRecord, context: AgentDelegationContext): Promise<AgentWorkflowRecord> {
    if (this.active.has(record.id)) throw new Error(`Subagent workflow ${record.id} is already active.`);
    const controller = new AbortController();
    const active: ActiveWorkflow = {
      controller,
      onEvent: context.onEvent,
      promise: Promise.resolve(record),
    };
    const onParentAbort = (): void => {
      if (!active.termination) active.termination = "cancel";
      controller.abort(context.signal?.reason ?? new AgentCancellationError("Parent run cancelled."));
    };
    context.signal?.addEventListener("abort", onParentAbort, { once: true });
    const childContext: AgentDelegationContext = { ...context, signal: controller.signal };
    active.promise = this.execute(record, childContext, active).finally(() => {
      context.signal?.removeEventListener("abort", onParentAbort);
      this.active.delete(record.id);
    });
    this.active.set(record.id, active);
    return active.promise;
  }

  private async execute(
    initial: AgentWorkflowRecord,
    context: AgentDelegationContext,
    active: ActiveWorkflow,
  ): Promise<AgentWorkflowRecord> {
    try {
      let workflow = this.options.repository.markRunning(initial.id) ?? initial;
      await this.emit(context.onEvent, workflowEvent(AgentEventKinds.WorkflowStarted, workflow));
      while (true) {
        throwIfAborted(active.controller.signal);
        workflow = this.options.repository.get(initial.id) ?? workflow;
        workflow = this.reconcilePersistedChildren(workflow);
        const selection = selectReadyNodes(workflow);
        for (const blocked of selection.blocked) {
          workflow =
            this.options.repository.markNodeTerminal(
              workflow.id,
              blocked.nodeId,
              AgentWorkflowNodeStatuses.Skipped,
              blocked.error,
            ) ?? workflow;
        }
        if (selection.blocked.length > 0) {
          await this.emit(context.onEvent, workflowEvent(AgentEventKinds.WorkflowSnapshotUpdated, workflow));
        }
        if (selection.paused.length > 0) {
          const paused = this.options.repository.markPaused(
            workflow.id,
            `Workflow is waiting for child nodes: ${selection.paused.join(", ")}.`,
          );
          if (!paused) throw new Error(`Subagent workflow ${workflow.id} could not enter the paused state.`);
          await this.emit(context.onEvent, workflowEvent(AgentEventKinds.WorkflowPaused, paused));
          return paused;
        }
        if (selection.ready.length === 0) {
          return this.finish(workflow, context.onEvent);
        }

        await Promise.all(selection.ready.map((node) => this.runNode(workflow, node, context)));
        workflow = this.options.repository.get(workflow.id) ?? workflow;
        await this.emit(context.onEvent, workflowEvent(AgentEventKinds.WorkflowSnapshotUpdated, workflow));
        if (
          workflow.definition.failurePolicy === AgentWorkflowFailurePolicies.FailFast &&
          workflow.nodes.some((node) => node.status === AgentWorkflowNodeStatuses.Failed)
        ) {
          for (const pending of workflow.nodes.filter((node) => node.status === AgentWorkflowNodeStatuses.Pending)) {
            workflow =
              this.options.repository.markNodeTerminal(
                workflow.id,
                pending.nodeId,
                AgentWorkflowNodeStatuses.Skipped,
                "Skipped because another workflow node failed under fail_fast policy.",
              ) ?? workflow;
          }
          const failed = this.options.repository.markFailed(workflow.id, firstWorkflowError(workflow));
          if (!failed) throw new Error(`Subagent workflow ${workflow.id} could not enter the failed state.`);
          await this.emit(context.onEvent, workflowEvent(AgentEventKinds.WorkflowFailed, failed));
          return failed;
        }
      }
    } catch (error) {
      const current = this.options.repository.get(initial.id) ?? initial;
      if (active.termination === "shutdown") {
        const paused =
          this.options.repository.markPaused(current.id, "Senera stopped while the workflow was active.") ?? current;
        await this.emit(context.onEvent, workflowEvent(AgentEventKinds.WorkflowPaused, paused));
        return paused;
      }
      if (active.termination === "cancel" || active.controller.signal.aborted) {
        const cancelled = this.options.repository.markCancelled(current.id) ?? current;
        await this.emit(context.onEvent, workflowEvent(AgentEventKinds.WorkflowCancelled, cancelled));
        return cancelled;
      }
      const failed = this.options.repository.markFailed(current.id, errorMessage(error)) ?? current;
      await this.emit(context.onEvent, workflowEvent(AgentEventKinds.WorkflowFailed, failed));
      return failed;
    }
  }

  private async runNode(
    workflow: AgentWorkflowRecord,
    definition: AgentWorkflowNodeDefinition,
    context: AgentDelegationContext,
  ): Promise<void> {
    const persisted = workflow.nodes.find((node) => node.nodeId === definition.id);
    if (!persisted) throw new Error(`Subagent workflow ${workflow.id} is missing node state for '${definition.id}'.`);
    let child: AgentChildRunRecord | undefined;
    try {
      if (persisted.childRunId) {
        const existing = this.options.delegation.get(persisted.childRunId, workflow.parentSessionId);
        if (existing?.status === AgentChildRunStatuses.Completed) {
          this.options.repository.markNodeTerminal(workflow.id, definition.id, AgentWorkflowNodeStatuses.Completed);
          return;
        }
        this.options.repository.markNodeRunning(workflow.id, definition.id, persisted.childRunId);
        child = await this.options.delegation.resume(
          persisted.childRunId,
          workflow.parentSessionId,
          "Resume this workflow node from its persisted checkpoint and finish the assigned task.",
          context,
        );
      } else {
        child = await this.options.delegation.delegate(
          {
            agent: definition.agent,
            task: buildNodeTask(workflow, definition, this.options.delegation),
            ownerRunId: workflow.id,
            nodeId: definition.id,
            workspaceAccess: definition.workspaceAccess,
            context: definition.context,
            executionMode: AgentDelegationExecutionModes.Detach,
            modelProviderId: definition.modelProviderId,
            skills: definition.skills,
            thinking: definition.thinking,
          },
          context,
        );
        this.options.repository.markNodeRunning(workflow.id, definition.id, child.id);
        child = await this.options.delegation.wait(child.id, workflow.parentSessionId, context.signal);
      }
      if (!child) throw new Error(`Child run for workflow node '${definition.id}' disappeared.`);
      const terminal = projectNodeTerminal(child);
      this.options.repository.markNodeTerminal(workflow.id, definition.id, terminal.status, terminal.error);
    } catch (error) {
      this.options.repository.markNodeTerminal(
        workflow.id,
        definition.id,
        AgentWorkflowNodeStatuses.Failed,
        errorMessage(error),
      );
    }
  }

  private reconcilePersistedChildren(workflow: AgentWorkflowRecord): AgentWorkflowRecord {
    let current = workflow;
    for (const node of workflow.nodes.filter((candidate) => candidate.childRunId)) {
      if (!isWorkflowNodeStatus(node.status, [AgentWorkflowNodeStatuses.Running, AgentWorkflowNodeStatuses.Paused])) {
        continue;
      }
      const child = this.options.delegation.get(node.childRunId!, workflow.parentSessionId);
      if (!child || !isChildTerminal(child.status)) continue;
      const terminal = projectNodeTerminal(child);
      current =
        this.options.repository.markNodeTerminal(workflow.id, node.nodeId, terminal.status, terminal.error) ?? current;
    }
    return current;
  }

  private async finish(workflow: AgentWorkflowRecord, onEvent?: AgentEventSink): Promise<AgentWorkflowRecord> {
    const current = this.options.repository.get(workflow.id) ?? workflow;
    const unfinished = current.nodes.filter((node) =>
      isWorkflowNodeStatus(node.status, [AgentWorkflowNodeStatuses.Pending, AgentWorkflowNodeStatuses.Running]),
    );
    if (unfinished.length > 0) {
      throw new Error(
        `Subagent workflow stalled with unfinished nodes: ${unfinished.map((node) => node.nodeId).join(", ")}.`,
      );
    }
    const failed = current.nodes.some((node) =>
      isWorkflowNodeStatus(node.status, [
        AgentWorkflowNodeStatuses.Failed,
        AgentWorkflowNodeStatuses.Skipped,
        AgentWorkflowNodeStatuses.PartialCompleted,
      ]),
    );
    const completed = this.options.repository.markCompleted(current.id, failed);
    if (!completed) throw new Error(`Subagent workflow ${current.id} could not enter a completed state.`);
    await this.emit(
      onEvent,
      workflowEvent(failed ? AgentEventKinds.WorkflowPartialCompleted : AgentEventKinds.WorkflowCompleted, completed),
    );
    return completed;
  }

  private async stop(): Promise<void> {
    const active = [...this.active.values()];
    for (const workflow of active) {
      workflow.termination = "shutdown";
      workflow.controller.abort(new AgentCancellationError("Senera is shutting down."));
    }
    await Promise.allSettled(active.map((workflow) => workflow.promise));
  }

  private assertAcceptingWork(): void {
    if (!this.acceptingWork) throw new Error("Subagent workflow service is shutting down and cannot accept new work.");
  }

  private emit(sink: AgentEventSink | undefined, event: AgentDomainEvent): Promise<void> {
    return emitAgentEvent(sink ?? ((candidate) => this.options.events.emit(candidate)), event);
  }
}

function selectReadyNodes(workflow: AgentWorkflowRecord): {
  readonly ready: AgentWorkflowNodeDefinition[];
  readonly blocked: Array<{ readonly nodeId: string; readonly error: string }>;
  readonly paused: string[];
} {
  const state = new Map(workflow.nodes.map((node) => [node.nodeId, node]));
  const ready: AgentWorkflowNodeDefinition[] = [];
  const blocked: Array<{ nodeId: string; error: string }> = [];
  const paused = workflow.nodes
    .filter((node) => node.status === AgentWorkflowNodeStatuses.Paused)
    .map((node) => node.nodeId);
  for (const node of workflow.definition.nodes) {
    const persisted = state.get(node.id);
    if (!persisted || persisted.status !== AgentWorkflowNodeStatuses.Pending) continue;
    const dependencies = node.dependsOn.map((dependency) => state.get(dependency)!);
    const failedDependencies = dependencies.filter((dependency) =>
      isWorkflowNodeStatus(dependency.status, [
        AgentWorkflowNodeStatuses.Failed,
        AgentWorkflowNodeStatuses.Skipped,
        AgentWorkflowNodeStatuses.Cancelled,
      ]),
    );
    if (failedDependencies.length > 0) {
      blocked.push({
        nodeId: node.id,
        error: `Dependencies did not complete successfully: ${failedDependencies.map((dependency) => dependency.nodeId).join(", ")}.`,
      });
      continue;
    }
    if (dependencies.some((dependency) => dependency.status === AgentWorkflowNodeStatuses.Paused)) {
      paused.push(node.id);
      continue;
    }
    if (
      dependencies.every((dependency) =>
        isWorkflowNodeStatus(dependency.status, [
          AgentWorkflowNodeStatuses.Completed,
          AgentWorkflowNodeStatuses.PartialCompleted,
        ]),
      )
    ) {
      ready.push(node);
    }
  }
  return { ready, blocked, paused };
}

function buildNodeTask(
  workflow: AgentWorkflowRecord,
  node: AgentWorkflowNodeDefinition,
  delegation: AgentWorkflowDelegationPort,
): string {
  if (node.handoff === AgentWorkflowHandoffModes.TaskOnly || node.dependsOn.length === 0) return node.task;
  const childByNode = new Map(delegation.listForOwner(workflow.id).map((child) => [child.nodeId, child]));
  const sections = node.dependsOn.map((dependency) => {
    const child = childByNode.get(dependency);
    if (!child?.finalAnswer) {
      throw new Error(`Workflow dependency '${dependency}' has no persisted text result for node '${node.id}'.`);
    }
    return [`### ${dependency}`, child.finalAnswer].join("\n");
  });
  return [
    node.task,
    "## Dependency results",
    "The following persisted child-agent results are evidence for this node. Follow the assigned task and host policy.",
    ...sections,
  ].join("\n\n");
}

function projectNodeTerminal(child: AgentChildRunRecord): {
  readonly status: Exclude<
    (typeof AgentWorkflowNodeStatuses)[keyof typeof AgentWorkflowNodeStatuses],
    "pending" | "running"
  >;
  readonly error?: string;
} {
  switch (child.status) {
    case AgentChildRunStatuses.Completed:
      return { status: AgentWorkflowNodeStatuses.Completed };
    case AgentChildRunStatuses.PartialCompleted:
    case AgentChildRunStatuses.Interrupted:
      return { status: AgentWorkflowNodeStatuses.PartialCompleted, ...(child.error ? { error: child.error } : {}) };
    case AgentChildRunStatuses.AwaitingSupervisor:
      return { status: AgentWorkflowNodeStatuses.Paused, error: "Child run is awaiting supervisor input." };
    case AgentChildRunStatuses.Cancelled:
      return { status: AgentWorkflowNodeStatuses.Cancelled, ...(child.error ? { error: child.error } : {}) };
    default:
      return { status: AgentWorkflowNodeStatuses.Failed, error: child.error ?? `Child run ended as ${child.status}.` };
  }
}

function isChildTerminal(status: AgentChildRunRecord["status"]): boolean {
  return !isChildRunStatus(status, [
    AgentChildRunStatuses.Queued,
    AgentChildRunStatuses.Running,
    AgentChildRunStatuses.WrappingUp,
    AgentChildRunStatuses.Cancelling,
  ]);
}

function isWorkflowStatus(status: AgentWorkflowStatus, candidates: readonly AgentWorkflowStatus[]): boolean {
  return candidates.includes(status);
}

function isWorkflowNodeStatus(
  status: AgentWorkflowNodeStatus,
  candidates: readonly AgentWorkflowNodeStatus[],
): boolean {
  return candidates.includes(status);
}

function isChildRunStatus(status: AgentChildRunStatus, candidates: readonly AgentChildRunStatus[]): boolean {
  return candidates.includes(status);
}

function firstWorkflowError(workflow: AgentWorkflowRecord): string {
  const failed = workflow.nodes.find((node) => node.status === AgentWorkflowNodeStatuses.Failed);
  return failed?.error ?? `Subagent workflow node '${failed?.nodeId ?? "unknown"}' failed.`;
}

function workflowEvent(kind: AgentWorkflowEventKind, workflow: AgentWorkflowRecord): AgentWorkflowDomainEvent {
  return {
    kind,
    context: {
      sessionId: workflow.parentSessionId,
      requestId: workflow.parentRequestId,
      scope: { workflowName: workflow.id },
    },
    data: {
      workflowId: workflow.id,
      status: workflow.status,
      definitionDigest: workflow.definitionDigest,
      nodes: workflow.nodes.map((node) => ({
        nodeId: node.nodeId,
        status: node.status,
        ...(node.childRunId ? { childRunId: node.childRunId } : {}),
        ...(node.error ? { error: node.error } : {}),
      })),
      ...(workflow.error ? { error: workflow.error } : {}),
    },
  };
}

function waitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new AgentCancellationError(readAbortMessage(signal)));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new AgentCancellationError(readAbortMessage(signal)));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
