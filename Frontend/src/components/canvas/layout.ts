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
    // 每 28 字符当一行
    extra += Math.min(60, Math.ceil(step.description.length / 28) * NODE_LINE_HEIGHT);
  }
  if (step.kind === "tool" && step.callId) extra += NODE_LINE_HEIGHT;
  if (step.toolErrorMessage || step.errorMessage) extra += 2 * NODE_LINE_HEIGHT;
  return NODE_BASE_HEIGHT + extra;
}

/** 把 timeline steps 转成 React Flow 节点 + 边，自动用 dagre 计算位置 */
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

  // 收集每个 step 的"前驱"——默认是上一个 step；多个连续 tool 共用同一个决策前驱
  const prevByStepIndex: Array<number | null> = new Array(steps.length).fill(null);
  // 找最近的非 tool 决策节点作为多个并行 tool 的 fan-out 源
  let lastNonToolIdx: number | null = null;
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (step.kind === "tool") {
      // 工具调用：fan-out 自最近一次 decision（如果存在）
      const decisionIdx = findLastIndex(steps, (s, idx) => idx < i && s.kind === "decision");
      prevByStepIndex[i] = decisionIdx !== -1 ? decisionIdx : i - 1;
    } else {
      prevByStepIndex[i] = lastNonToolIdx !== null ? lastNonToolIdx : i - 1;
      // 如果当前是非 tool，且上一个也是 tool（们），把所有 tool 收束到当前
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

  // 工具收束：找出连续 tool 段，把它们都连到下一个非 tool 节点
  for (let i = 0; i < steps.length; i += 1) {
    if (steps[i].kind !== "tool") continue;
    // 找下一个非 tool 节点
    const nextNonTool = steps.findIndex((s, idx) => idx > i && s.kind !== "tool");
    if (nextNonTool === -1) continue;
    const source = steps[i].id;
    const target = steps[nextNonTool].id;
    // 避免与已有边重复
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

// 给 export 用的 kind 类型一致性提示——避免警告
export type _KindUsage = TimelineStepKind;
