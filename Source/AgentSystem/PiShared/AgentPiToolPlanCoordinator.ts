import { createOpaqueId } from "../Core/AgentIds.js";
import type {
  AgentPiPlannedToolCall,
  AgentPiToolPlanState,
  AgentPiToolTranscriptItem,
} from "./AgentPiPlanningTypes.js";
import {
  AgentToolOutputAvailabilities,
  readAgentToolAssessmentStatus,
  type AgentToolAssessmentStatus,
} from "../ToolRuntime/AgentToolResultOutcome.js";
import { AgentPiToolObservationStatuses } from "./AgentPiToolObservationStatus.js";

export const AgentPiToolPlanNodeStatuses = {
  Planned: "planned",
  Dispatched: "dispatched",
  Completed: "completed",
  Failed: "failed",
  Blocked: "blocked",
} as const;

export type AgentPiToolPlanNodeStatus = (typeof AgentPiToolPlanNodeStatuses)[keyof typeof AgentPiToolPlanNodeStatuses];

export interface AgentPiReadyToolPlanNode {
  readonly nodeId: string;
  readonly planIndex: number;
  readonly call: AgentPiPlannedToolCall;
  readonly preface: string;
}

export interface AgentPiToolPlanSnapshotNode {
  readonly planId: string;
  readonly revision: number;
  readonly nodeId: string;
  readonly planIndex: number;
  readonly toolName: string;
  readonly dependencyNodeIds: readonly string[];
  readonly status: AgentPiToolPlanNodeStatus;
  readonly callId?: string;
  readonly assessment?: AgentToolAssessmentStatus;
  readonly failure?: string;
}

interface AgentPiToolPlanNode {
  readonly nodeId: string;
  readonly planId: string;
  readonly planIndex: number;
  readonly call: AgentPiPlannedToolCall;
  readonly dependencyNodeIds: readonly string[];
  status: AgentPiToolPlanNodeStatus;
  callId?: string;
  assessment?: AgentToolAssessmentStatus;
  failure?: string;
}

interface AgentPiToolPlan {
  readonly id: string;
  readonly revision: number;
  readonly preface: string;
  prefaceDispatched: boolean;
  readonly nodeIds: readonly string[];
}

export class AgentPiToolPlanCoordinator {
  private readonly plans = new Map<string, AgentPiToolPlan>();
  private readonly nodes = new Map<string, AgentPiToolPlanNode>();
  private readonly nodeIdsByCallId = new Map<string, string>();
  private nextRevision = 1;

  accept(preface: string, calls: readonly AgentPiPlannedToolCall[]): string {
    const planId = createOpaqueId("toolplan");
    const nodes = calls.map<AgentPiToolPlanNode>((call, planIndex) => ({
      nodeId: createOpaqueId("toolnode"),
      planId,
      planIndex,
      call: clonePlannedCall(call),
      dependencyNodeIds: [],
      status: AgentPiToolPlanNodeStatuses.Planned,
    }));
    const resolvedNodes = nodes.map<AgentPiToolPlanNode>((node) => ({
      ...node,
      dependencyNodeIds: (node.call.dependsOn ?? []).map((dependency) => requireIndexedNode(nodes, dependency).nodeId),
    }));
    const plan: AgentPiToolPlan = {
      id: planId,
      revision: this.nextRevision,
      preface: preface.trim(),
      prefaceDispatched: false,
      nodeIds: resolvedNodes.map((node) => node.nodeId),
    };
    this.nextRevision += 1;
    this.plans.set(planId, plan);
    for (const node of resolvedNodes) this.nodes.set(node.nodeId, node);
    return planId;
  }

  reconcile(transcript: readonly AgentPiToolTranscriptItem[]): void {
    for (const item of transcript) {
      const node = this.nodeForCallId(item.callId);
      if (!node || node.status !== AgentPiToolPlanNodeStatuses.Dispatched || !item.observation) continue;
      const observation = item.observation;
      if (observation.status === AgentPiToolObservationStatuses.Failure) {
        node.failure = observation.summary ?? "Tool execution failed.";
      }
      if (observation.outputAvailability !== AgentToolOutputAvailabilities.None) {
        node.status = AgentPiToolPlanNodeStatuses.Completed;
        node.assessment = terminalAssessment(observation.status);
        continue;
      }
      if (observation.status === AgentPiToolObservationStatuses.Failure) {
        this.failNode(node, node.failure ?? "Tool execution failed.");
      }
    }
    this.propagateBlockedDependencies();
  }

  ready(parallelToolCalls = true): AgentPiReadyToolPlanNode[] {
    this.propagateBlockedDependencies();
    const ready = [...this.nodes.values()]
      .filter((node) => this.isReady(node))
      .map((node) => {
        const plan = this.requirePlan(node.planId);
        return {
          nodeId: node.nodeId,
          planIndex: node.planIndex,
          call: clonePlannedCall(node.call),
          preface: plan.prefaceDispatched ? "" : plan.preface,
        };
      });
    return parallelToolCalls ? ready : ready.slice(0, 1);
  }

  dispatch(nodeId: string, callId: string): void {
    const node = this.requireNode(nodeId);
    if (node.status !== AgentPiToolPlanNodeStatuses.Planned) {
      throw new Error(`Tool plan node cannot be dispatched from status ${node.status}: ${nodeId}`);
    }
    const existingNodeId = this.nodeIdsByCallId.get(callId);
    if (existingNodeId && existingNodeId !== nodeId) {
      throw new Error(`Tool call id is already assigned to another plan node: ${callId}`);
    }
    node.status = AgentPiToolPlanNodeStatuses.Dispatched;
    node.callId = callId;
    this.nodeIdsByCallId.set(callId, nodeId);
    const plan = this.plans.get(node.planId);
    if (plan) plan.prefaceDispatched = true;
  }

  reject(nodeId: string, reason: string): void {
    this.failNode(this.requireNode(nodeId), reason);
    this.propagateBlockedDependencies();
  }

  hasUnreconciledCalls(): boolean {
    return [...this.nodes.values()].some((node) => node.status === AgentPiToolPlanNodeStatuses.Dispatched);
  }

  snapshot(): AgentPiToolPlanSnapshotNode[] {
    return [...this.nodes.values()].map((node) => ({
      planId: node.planId,
      revision: this.plans.get(node.planId)?.revision ?? 0,
      nodeId: node.nodeId,
      planIndex: node.planIndex,
      toolName: node.call.toolName,
      dependencyNodeIds: [...node.dependencyNodeIds],
      status: node.status,
      callId: node.callId,
      assessment: node.assessment,
      failure: node.failure,
    }));
  }

  state(): AgentPiToolPlanState {
    const nodes = this.snapshot();
    return {
      revisions: [...this.plans.values()].map((plan) => ({
        planId: plan.id,
        revision: plan.revision,
        nodes: nodes
          .filter((node) => node.planId === plan.id)
          .map(({ planId: _planId, revision: _revision, ...node }) => ({
            ...node,
            dependencyNodeIds: [...node.dependencyNodeIds],
          })),
      })),
    };
  }

  private isReady(node: AgentPiToolPlanNode): boolean {
    return (
      node.status === AgentPiToolPlanNodeStatuses.Planned &&
      node.dependencyNodeIds.every(
        (dependencyNodeId) => this.nodes.get(dependencyNodeId)?.status === AgentPiToolPlanNodeStatuses.Completed,
      )
    );
  }

  private propagateBlockedDependencies(): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of this.nodes.values()) {
        if (node.status !== AgentPiToolPlanNodeStatuses.Planned) continue;
        const blockingDependency = node.dependencyNodeIds
          .map((nodeId) => this.nodes.get(nodeId))
          .find(
            (dependency) =>
              dependency?.status === AgentPiToolPlanNodeStatuses.Failed ||
              dependency?.status === AgentPiToolPlanNodeStatuses.Blocked,
          );
        if (!blockingDependency) continue;
        node.status = AgentPiToolPlanNodeStatuses.Blocked;
        node.failure = `Dependency ${blockingDependency.nodeId} did not succeed.`;
        changed = true;
      }
    }
  }

  private nodeForCallId(callId: string): AgentPiToolPlanNode | undefined {
    const nodeId = this.nodeIdsByCallId.get(callId);
    return nodeId ? this.nodes.get(nodeId) : undefined;
  }

  private requireNode(nodeId: string): AgentPiToolPlanNode {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Tool plan node is not registered: ${nodeId}`);
    return node;
  }

  private requirePlan(planId: string): AgentPiToolPlan {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Tool plan is not registered: ${planId}`);
    return plan;
  }

  private failNode(node: AgentPiToolPlanNode, reason: string): void {
    node.status = AgentPiToolPlanNodeStatuses.Failed;
    node.failure = reason;
  }
}

function requireIndexedNode(nodes: readonly AgentPiToolPlanNode[], index: number): AgentPiToolPlanNode {
  const node = nodes.at(index);
  if (!node) throw new Error(`Tool plan dependency index is not registered: ${index}`);
  return node;
}

function clonePlannedCall(call: AgentPiPlannedToolCall): AgentPiPlannedToolCall {
  return {
    ...call,
    dependsOn: call.dependsOn ? [...call.dependsOn] : undefined,
  };
}

function terminalAssessment(
  status: NonNullable<AgentPiToolTranscriptItem["observation"]>["status"],
): AgentToolAssessmentStatus | undefined {
  return readAgentToolAssessmentStatus(status);
}
