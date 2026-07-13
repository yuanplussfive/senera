import dagre from "@dagrejs/dagre";
import { type Edge, type Node, Position } from "@xyflow/react";
import type { TimelineStep, TimelineStepKind } from "../../store/sessionStore";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";

export type StepNodeData = Record<string, unknown> &
  (
    | {
        kind: "step";
        step: TimelineStep;
      }
    | {
        kind: "scope";
        group: ScopeNodeData;
      }
  );

export interface ScopeNodeData {
  id: string;
  label: string;
  description?: string;
  status: TimelineStep["status"];
  workflowName?: string;
  role?: NonNullable<TimelineStep["scope"]>["role"];
}

const NODE_WIDTH = 240;
const NODE_BASE_HEIGHT = 76;
const SCOPE_NODE_HEIGHT = 68;
const NODE_LINE_HEIGHT = 18;

function estimateNodeHeight(step: TimelineStep): number {
  let extra = 0;
  if (step.description) {
    // Approximate wrapped description lines without measuring DOM layout.
    extra += Math.min(60, Math.ceil(step.description.length / 28) * NODE_LINE_HEIGHT);
  }
  if (step.kind === "tool" && step.callId) extra += NODE_LINE_HEIGHT;
  if (step.toolErrorMessage || step.errorMessage) extra += 2 * NODE_LINE_HEIGHT;
  return NODE_BASE_HEIGHT + extra;
}

interface FlowNode {
  id: string;
  width: number;
  height: number;
  data: StepNodeData;
}

/** Convert timeline steps into positioned React Flow nodes and edges. */
export function layoutSteps(steps: TimelineStep[]): {
  nodes: Node<StepNodeData>[];
  edges: Edge[];
} {
  if (steps.length === 0) return { nodes: [], edges: [] };

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "TB",
    nodesep: 36,
    ranksep: 48,
    marginx: 24,
    marginy: 24,
  });
  g.setDefaultEdgeLabel(() => ({}));

  const flowNodes = new Map<string, FlowNode>();
  const edges: Edge[] = [];
  const edgeIds = new Set<string>();

  const addEdge = (source: string | null | undefined, target: string, status: TimelineStep["status"]): void => {
    if (!source || source === target) return;
    const id = `${source}->${target}`;
    if (edgeIds.has(id)) return;
    edgeIds.add(id);
    g.setEdge(source, target);
    edges.push({
      id,
      source,
      target,
      type: "smoothstep",
      animated: status === "running",
      style: edgeStyle(status),
    });
  };

  const addStepNode = (step: TimelineStep): void => {
    if (flowNodes.has(step.id)) return;
    flowNodes.set(step.id, {
      id: step.id,
      width: NODE_WIDTH,
      height: estimateNodeHeight(step),
      data: {
        kind: "step",
        step,
      },
    });
  };

  const ensureScopeNode = (step: TimelineStep): ScopeNodeData | undefined => {
    if (!step.scope?.parentRequestId) return undefined;
    const id = scopeNodeId(step);
    const existing = flowNodes.get(id)?.data;
    if (existing?.kind === "scope") {
      existing.group.status = mergeNodeStatus(existing.group.status, step.status);
      return existing.group;
    }

    const group: ScopeNodeData = {
      id,
      label: scopeNodeLabel(step),
      description: step.scope.workflowName,
      status: step.status,
      workflowName: step.scope.workflowName,
      role: step.scope.role,
    };
    flowNodes.set(id, {
      id,
      width: NODE_WIDTH,
      height: SCOPE_NODE_HEIGHT,
      data: {
        kind: "scope",
        group,
      },
    });
    return group;
  };

  const scopeGroups = new Map<string, ScopeStepGroup>();

  steps.forEach((step, index) => {
    if (!step.scope?.parentRequestId) return;
    const group = ensureScopeNode(step);
    if (!group) return;
    const current = scopeGroups.get(group.id) ?? {
      id: group.id,
      role: group.role,
      steps: [],
      firstIndex: index,
    };
    current.steps.push(step);
    current.firstIndex = Math.min(current.firstIndex, index);
    scopeGroups.set(group.id, current);
  });

  const entries = groupLayoutEntries(steps, scopeGroups);
  let previousMainId: string | null = null;
  let openTails: string[] = [];

  const sources = (): Array<string | null> => (openTails.length > 0 ? openTails : [previousMainId]);

  const connectSources = (targets: readonly string[], status: TimelineStep["status"]): void => {
    for (const source of sources()) {
      for (const target of targets) {
        addEdge(source, target, status);
      }
    }
  };

  for (const entry of entries) {
    if (entry.kind === "toolBatch") {
      for (const step of entry.steps) {
        addStepNode(step);
      }
      connectSources(
        entry.steps.map((step) => step.id),
        aggregateStatus(entry.steps),
      );
      openTails = entry.steps.map((step) => step.id);
      continue;
    }

    if (entry.kind === "scopeParallel") {
      const targets: string[] = [];
      const tails: string[] = [];
      for (const group of entry.groups) {
        targets.push(group.id);
        tails.push(chainScopeGroup(group));
      }
      connectSources(targets, aggregateStatus(entry.groups.flatMap((group) => group.steps)));
      openTails = tails;
      continue;
    }

    if (entry.kind === "scope") {
      connectSources([entry.group.id], aggregateStatus(entry.group.steps));
      openTails = [chainScopeGroup(entry.group)];
      continue;
    }

    const step = entry.step;
    addStepNode(step);
    connectSources([step.id], step.status);
    previousMainId = step.id;
    openTails = [];
  }

  function chainScopeGroup(group: ScopeStepGroup): string {
    let tail = group.id;
    for (const step of group.steps) {
      addStepNode(step);
      addEdge(tail, step.id, step.status);
      tail = step.id;
    }
    return tail;
  }

  const graphNodes = [...flowNodes.values()];
  for (const node of graphNodes) {
    g.setNode(node.id, { width: node.width, height: node.height });
  }

  dagre.layout(g);

  const nodes: Node<StepNodeData>[] = graphNodes.map((node) => {
    const pos = g.node(node.id);
    return {
      id: node.id,
      type: "step",
      position: {
        x: pos.x - node.width / 2,
        y: pos.y - node.height / 2,
      },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      data: node.data,
      draggable: true,
    };
  });

  return { nodes, edges };
}

type LayoutEntry =
  | {
      kind: "root";
      step: TimelineStep;
    }
  | {
      kind: "toolBatch";
      steps: TimelineStep[];
    }
  | {
      kind: "scope";
      group: ScopeStepGroup;
    }
  | {
      kind: "scopeParallel";
      groups: ScopeStepGroup[];
    };

interface ScopeStepGroup {
  id: string;
  role?: ScopeNodeData["role"];
  steps: TimelineStep[];
  firstIndex: number;
}

interface ToolBatchGroup {
  id: string;
  steps: TimelineStep[];
  firstIndex: number;
}

function groupLayoutEntries(steps: TimelineStep[], scopeGroups: ReadonlyMap<string, ScopeStepGroup>): LayoutEntry[] {
  const rawEntries: LayoutEntry[] = [];
  const emittedScopeGroups = new Set<string>();
  const toolBatches = collectToolBatches(steps);
  const emittedToolBatches = new Set<string>();

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (step.scope?.parentRequestId) {
      const groupId = scopeNodeId(step);
      const group = scopeGroups.get(groupId);
      if (group && !emittedScopeGroups.has(groupId) && group.firstIndex === index) {
        rawEntries.push({ kind: "scope", group });
        emittedScopeGroups.add(groupId);
      }
      continue;
    }

    const toolBatchId = toolBatchNodeId(step);
    if (toolBatchId) {
      const batch = toolBatches.get(toolBatchId);
      if (batch && !emittedToolBatches.has(toolBatchId) && batch.firstIndex === index) {
        rawEntries.push({ kind: "toolBatch", steps: batch.steps });
        emittedToolBatches.add(toolBatchId);
      }
      continue;
    }

    rawEntries.push({ kind: "root", step });
  }

  const entries: LayoutEntry[] = [];
  for (let index = 0; index < rawEntries.length; index += 1) {
    const entry = rawEntries[index];
    if (entry.kind !== "scope" || entry.group.role === "merge") {
      entries.push(entry);
      continue;
    }

    const groups: ScopeStepGroup[] = [entry.group];
    let cursor = index + 1;
    while (cursor < rawEntries.length) {
      const candidate = rawEntries[cursor];
      if (candidate.kind !== "scope" || candidate.group.role === "merge") break;
      groups.push(candidate.group);
      cursor += 1;
    }
    entries.push({ kind: "scopeParallel", groups });
    index = cursor - 1;
  }
  return entries;
}

function collectToolBatches(steps: readonly TimelineStep[]): Map<string, ToolBatchGroup> {
  const batches = new Map<string, ToolBatchGroup>();
  steps.forEach((step, index) => {
    const batchId = toolBatchNodeId(step);
    if (!batchId) return;
    const current = batches.get(batchId) ?? {
      id: batchId,
      steps: [],
      firstIndex: index,
    };
    current.steps.push(step);
    current.firstIndex = Math.min(current.firstIndex, index);
    batches.set(batchId, current);
  });

  for (const group of batches.values()) {
    group.steps.sort(compareToolBatchSteps);
  }
  return batches;
}

function toolBatchNodeId(step: TimelineStep): string | undefined {
  if (step.kind !== "tool" || !step.callId || !step.toolBatch?.id) return undefined;
  return step.toolBatch.id;
}

function compareToolBatchSteps(left: TimelineStep, right: TimelineStep): number {
  const leftIndex = left.toolBatch?.index;
  const rightIndex = right.toolBatch?.index;
  if (leftIndex !== undefined && rightIndex !== undefined && leftIndex !== rightIndex) {
    return leftIndex - rightIndex;
  }
  return left.startedAt.localeCompare(right.startedAt);
}

function aggregateStatus(steps: readonly TimelineStep[]): TimelineStep["status"] {
  return steps.reduce<TimelineStep["status"]>((status, step) => mergeNodeStatus(status, step.status), "done");
}

function scopeNodeId(step: TimelineStep): string {
  return ["scope", step.scope?.workflowName, step.scope?.role, step.scope?.jobId, step.scope?.agentName]
    .filter((value) => value !== undefined && value !== "")
    .join(":");
}

function scopeNodeLabel(step: TimelineStep): string {
  if (step.scope?.role === "merge") return frontendMessage("workflow.scope.merge");
  return step.scope?.agentName
    ? frontendMessage("workflow.scope.agentNamed", { name: step.scope.agentName })
    : frontendMessage("workflow.scope.agent");
}

function mergeNodeStatus(current: TimelineStep["status"], next: TimelineStep["status"]): TimelineStep["status"] {
  if (current === "failed" || next === "failed") return "failed";
  if (current === "running" || next === "running") return "running";
  if (current === "pending" || next === "pending") return "pending";
  return "done";
}

function edgeStyle(status: TimelineStep["status"]): React.CSSProperties {
  if (status === "failed") return { stroke: "rgb(var(--color-brick-600))", strokeWidth: 1.5 };
  if (status === "running") return { stroke: "rgb(var(--color-umber-500))", strokeWidth: 1.5 };
  return { stroke: "rgb(var(--color-ink-300))", strokeWidth: 1 };
}

// Keep the exported step-kind type tied to the store contract.
export type _KindUsage = TimelineStepKind;
