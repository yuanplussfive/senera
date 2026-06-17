import dagre from "@dagrejs/dagre";
import { type Edge, type Node, Position } from "@xyflow/react";
import type { TimelineStep, TimelineStepKind } from "../../store/sessionStore";

export interface StepNodeData extends Record<string, unknown> {
  step: TimelineStep;
}

const NODE_WIDTH = 240;
const NODE_BASE_HEIGHT = 76;
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

  const prevByStepIndex: Array<number | null> = new Array(steps.length).fill(null);
  // Consecutive tool steps fan out from the nearest decision step when present.
  let lastNonToolIdx: number | null = null;
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (step.kind === "tool") {
      const decisionIdx = findLastIndex(steps, (s, idx) => idx < i && s.kind === "decision");
      prevByStepIndex[i] = decisionIdx !== -1 ? decisionIdx : i - 1;
    } else {
      prevByStepIndex[i] = lastNonToolIdx !== null ? lastNonToolIdx : i - 1;
      lastNonToolIdx = i;
    }
  }

  const heights: number[] = steps.map(estimateNodeHeight);

  steps.forEach((step, i) => {
    g.setNode(step.id, { width: NODE_WIDTH, height: heights[i] });
  });

  const edges: Edge[] = [];
  steps.forEach((step, i) => {
    const prev = prevByStepIndex[i];
    if (prev === null || prev < 0) return;
    const source = steps[prev].id;
    const target = step.id;
    g.setEdge(source, target);
    edges.push({
      id: `${source}->${target}`,
      source,
      target,
      type: "smoothstep",
      animated: step.status === "running",
      style: edgeStyle(step.status),
    });
  });

  // Converge each tool step into the next non-tool step.
  for (let i = 0; i < steps.length; i += 1) {
    if (steps[i].kind !== "tool") continue;
    const nextNonTool = steps.findIndex((s, idx) => idx > i && s.kind !== "tool");
    if (nextNonTool === -1) continue;
    const source = steps[i].id;
    const target = steps[nextNonTool].id;
    if (edges.some((e) => e.source === source && e.target === target)) continue;
    g.setEdge(source, target);
    edges.push({
      id: `${source}->${target}`,
      source,
      target,
      type: "smoothstep",
      animated: steps[nextNonTool].status === "running",
      style: edgeStyle(steps[nextNonTool].status),
    });
  }

  dagre.layout(g);

  const nodes: Node<StepNodeData>[] = steps.map((step, i) => {
    const pos = g.node(step.id);
    return {
      id: step.id,
      type: "step",
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - heights[i] / 2,
      },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      data: { step },
      draggable: true,
    };
  });

  return { nodes, edges };
}

function edgeStyle(status: TimelineStep["status"]): React.CSSProperties {
  if (status === "failed") return { stroke: "#a8392a", strokeWidth: 1.5 };
  if (status === "running") return { stroke: "#8a6a3f", strokeWidth: 1.5 };
  return { stroke: "#bdb7a4", strokeWidth: 1 };
}

function findLastIndex<T>(
  arr: T[],
  predicate: (item: T, idx: number) => boolean,
): number {
  for (let i = arr.length - 1; i >= 0; i -= 1) {
    if (predicate(arr[i], i)) return i;
  }
  return -1;
}

// Keep the exported step-kind type tied to the store contract.
export type _KindUsage = TimelineStepKind;
