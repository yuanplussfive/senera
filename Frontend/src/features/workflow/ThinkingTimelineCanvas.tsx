import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
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
import { layoutSteps, type StepNodeData } from "./layout";
import { NodeDetailDrawer } from "./NodeDetailDrawer";

const NODE_TYPES = { step: StepNode };
const FIT_VIEW_PADDING = 0.16;
const FIT_VIEW_DURATION_MS = 240;

export function ThinkingTimelineCanvas({
  run,
  focusVersion = 0,
}: {
  run: RunRecord;
  focusVersion?: number;
}): JSX.Element {
  return (
    <ReactFlowProvider>
      <CanvasArea run={run} focusVersion={focusVersion} />
    </ReactFlowProvider>
  );
}

function CanvasArea({ run, focusVersion = 0 }: { run: RunRecord; focusVersion?: number }): JSX.Element {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [flowReady, setFlowReady] = useState(false);
  const rf = useReactFlow<Node<StepNodeData>>();
  const steps = run.steps;
  const selectedStep = useMemo(() => steps.find((step) => step.id === selectedStepId) ?? null, [steps, selectedStepId]);

  const { nodes, edges, translateExtent } = useMemo(() => {
    const { nodes, edges } = layoutSteps(steps);
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
  }, [steps]);

  const fitCanvas = useCallback(
    (duration = FIT_VIEW_DURATION_MS): void => {
      if (!flowReady || nodes.length === 0) return;
      window.requestAnimationFrame(() => {
        try {
          if (nodes.length > 8) {
            const recentNode =
              [...nodes].reverse().find((node) => node.data.kind === "step" && node.data.step.status === "running") ??
              nodes[nodes.length - 1];
            void rf.setCenter(recentNode.position.x + 120, recentNode.position.y + 54, { zoom: 0.86, duration });
            return;
          }
          void rf.fitView({ padding: FIT_VIEW_PADDING, duration, maxZoom: 1 });
        } catch {
          /* ignore */
        }
      });
    },
    [flowReady, nodes, rf],
  );

  useEffect(() => {
    if (!flowReady || nodes.length === 0) return;
    const timer = window.setTimeout(() => {
      fitCanvas();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [fitCanvas, flowReady, focusVersion, nodes.length, run.requestId, steps.length]);

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
    <div className="relative flex-1 overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: FIT_VIEW_PADDING, maxZoom: 1 }}
        minZoom={0.5}
        maxZoom={1.6}
        translateExtent={translateExtent}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll
        panOnScrollMode={"free" as never}
        zoomOnPinch
        zoomOnScroll={false}
        selectionOnDrag={false}
        onInit={() => {
          setFlowReady(true);
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--theme-canvas-grid)" />
        <Controls
          position="bottom-left"
          showInteractive={false}
          className={cn("!rounded-md !border !border-ink-200 !bg-paper-50 !shadow-none")}
        />
      </ReactFlow>
      <NodeDetailDrawer step={selectedStep} onClose={() => setSelectedStepId(null)} />
    </div>
  );
}
