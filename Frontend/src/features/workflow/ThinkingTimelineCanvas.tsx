import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Node,
  type NodeMouseHandler,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { type RunRecord } from "../../store/sessionStore";
import { cn } from "../../lib/util";
import { StepNode } from "./StepNode";
import { layoutSteps, type StepNodeData, type WorkflowLayoutDirection } from "./layout";
import { NodeDetailDrawer } from "./NodeDetailDrawer";

const NODE_TYPES = { step: StepNode };
const FIT_VIEW_DURATION_MS = 240;
const WORKFLOW_VIEWPORT_ZOOM = 0.86;
const WORKFLOW_VIEWPORT_EDGE_INSET = 24;
type WorkflowViewportMode = "start" | "latest";

export function readInitialWorkflowViewportMode(status: RunRecord["status"]): WorkflowViewportMode {
  return status === "running" ? "latest" : "start";
}

export function readWorkflowViewportTarget(
  nodes: readonly Node<StepNodeData>[],
  mode: WorkflowViewportMode,
): Node<StepNodeData> | undefined {
  const stepNodes = nodes.filter((node) => node.data.kind === "step");
  if (mode === "start") return stepNodes[0] ?? nodes[0];
  return (
    [...stepNodes].reverse().find((node) => node.data.kind === "step" && node.data.step.status === "running") ??
    stepNodes[stepNodes.length - 1] ??
    nodes[nodes.length - 1]
  );
}

export function readStartWorkflowViewport(
  node: Pick<Node<StepNodeData>, "data" | "position">,
  canvas: { width: number; height: number },
  layoutDirection: WorkflowLayoutDirection,
): { x: number; y: number; zoom: number } {
  const center = readWorkflowNodeCenter(node);
  if (layoutDirection === "horizontal") {
    return {
      x: WORKFLOW_VIEWPORT_EDGE_INSET - node.position.x * WORKFLOW_VIEWPORT_ZOOM,
      y: canvas.height / 2 - center.y * WORKFLOW_VIEWPORT_ZOOM,
      zoom: WORKFLOW_VIEWPORT_ZOOM,
    };
  }
  return {
    x: canvas.width / 2 - center.x * WORKFLOW_VIEWPORT_ZOOM,
    y: WORKFLOW_VIEWPORT_EDGE_INSET - node.position.y * WORKFLOW_VIEWPORT_ZOOM,
    zoom: WORKFLOW_VIEWPORT_ZOOM,
  };
}

function readWorkflowNodeCenter(node: Pick<Node<StepNodeData>, "data" | "position">): {
  x: number;
  y: number;
} {
  return {
    x: node.position.x + node.data.layout.width / 2,
    y: node.position.y + node.data.layout.height / 2,
  };
}

export function ThinkingTimelineCanvas({
  run,
  focusVersion = 0,
  layoutDirection = "vertical",
}: {
  run: RunRecord;
  focusVersion?: number;
  layoutDirection?: WorkflowLayoutDirection;
}): JSX.Element {
  return (
    <ReactFlowProvider>
      <CanvasArea run={run} focusVersion={focusVersion} layoutDirection={layoutDirection} />
    </ReactFlowProvider>
  );
}

function CanvasArea({
  run,
  focusVersion = 0,
  layoutDirection,
}: {
  run: RunRecord;
  focusVersion?: number;
  layoutDirection: WorkflowLayoutDirection;
}): JSX.Element {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [flowReady, setFlowReady] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const viewportSessionRef = useRef<{ key: string; followLive: boolean } | null>(null);
  const rf = useReactFlow<Node<StepNodeData>>();
  const steps = run.steps;
  const selectedStep = useMemo(() => steps.find((step) => step.id === selectedStepId) ?? null, [steps, selectedStepId]);

  const { nodes, edges, translateExtent } = useMemo(() => {
    const { nodes, edges } = layoutSteps(steps, layoutDirection);
    if (nodes.length === 0) {
      return {
        nodes,
        edges,
        translateExtent: [
          [-1000, -1000],
          [1000, 1000],
        ] as [[number, number], [number, number]],
      };
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
      minX = Math.min(minX, node.position.x);
      minY = Math.min(minY, node.position.y);
      maxX = Math.max(maxX, node.position.x + 240);
      maxY = Math.max(maxY, node.position.y + 120);
    }
    const padding = 200;
    return {
      nodes,
      edges,
      translateExtent: [
        [minX - padding, minY - padding],
        [maxX + padding, maxY + padding],
      ] as [[number, number], [number, number]],
    };
  }, [layoutDirection, steps]);

  const positionCanvas = useCallback(
    (mode: WorkflowViewportMode, duration = FIT_VIEW_DURATION_MS): void => {
      if (!flowReady || nodes.length === 0) return;
      window.requestAnimationFrame(() => {
        try {
          const targetNode = readWorkflowViewportTarget(nodes, mode);
          if (!targetNode) return;
          if (mode === "start" && canvasRef.current?.clientWidth && canvasRef.current.clientHeight) {
            void rf.setViewport(
              readStartWorkflowViewport(
                targetNode,
                { width: canvasRef.current.clientWidth, height: canvasRef.current.clientHeight },
                layoutDirection,
              ),
              { duration },
            );
            return;
          }
          const targetCenter = readWorkflowNodeCenter(targetNode);
          void rf.setCenter(targetCenter.x, targetCenter.y, {
            zoom: WORKFLOW_VIEWPORT_ZOOM,
            duration,
          });
        } catch {
          /* ignore */
        }
      });
    },
    [flowReady, layoutDirection, nodes, rf],
  );

  useEffect(() => {
    if (!flowReady || nodes.length === 0) return;
    const viewportKey = `${run.requestId}:${focusVersion}:${layoutDirection}`;
    const previousSession = viewportSessionRef.current;
    const isInitialPosition = previousSession?.key !== viewportKey;
    const followLive = isInitialPosition ? run.status === "running" : previousSession.followLive;
    if (!isInitialPosition && (!followLive || run.status !== "running")) return;
    const mode = isInitialPosition ? readInitialWorkflowViewportMode(run.status) : "latest";
    const timer = window.setTimeout(() => {
      positionCanvas(mode);
      viewportSessionRef.current = { key: viewportKey, followLive };
    }, 80);
    return () => window.clearTimeout(timer);
  }, [flowReady, focusVersion, layoutDirection, nodes.length, positionCanvas, run.requestId, run.status, steps.length]);

  useEffect(() => {
    if (!selectedStepId) return;
    if (steps.some((step) => step.id === selectedStepId)) return;
    setSelectedStepId(null);
  }, [selectedStepId, steps]);

  const handleNodeClick = useCallback<NodeMouseHandler<Node<StepNodeData>>>(
    (_, node) => {
      if (node.data.kind !== "step") {
        startTransition(() => setSelectedStepId(null));
        return;
      }
      if (node.id === selectedStepId) return;
      startTransition(() => setSelectedStepId(node.id));
    },
    [selectedStepId],
  );

  return (
    <div
      ref={canvasRef}
      className="relative flex-1 overflow-hidden bg-transparent"
      data-workflow-canvas-pan={focusVersion > 0 ? "free" : "vertical"}
      data-workflow-canvas-bounds={focusVersion > 0 ? "unbounded" : "content"}
      data-workflow-layout-direction={layoutDirection}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={handleNodeClick}
        minZoom={0.5}
        maxZoom={1.6}
        translateExtent={focusVersion > 0 ? undefined : translateExtent}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll
        panOnScrollMode={(focusVersion > 0 ? "free" : "vertical") as never}
        panOnDrag={focusVersion > 0}
        zoomOnPinch
        zoomOnScroll={false}
        selectionOnDrag={false}
        onInit={() => {
          setFlowReady(true);
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--theme-canvas-grid)" />
        <Controls
          position="bottom-left"
          showInteractive={false}
          className={cn("!overflow-hidden !rounded-lg !border !border-line-subtle !bg-surface-raised !shadow-panel")}
        />
      </ReactFlow>
      <NodeDetailDrawer step={selectedStep} onClose={() => setSelectedStepId(null)} />
    </div>
  );
}
