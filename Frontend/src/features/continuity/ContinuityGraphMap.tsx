import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeProps,
} from "@xyflow/react";
import { Maximize2 } from "lucide-react";
import "@xyflow/react/dist/style.css";
import "../../styles/react-flow.css";
import type { ContinuitySnapshotData } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { cn } from "../../lib/util";
import { IconButton, SegmentedControl } from "../../shared/ui";
import {
  projectContinuityGraph,
  type ContinuityGraphFlowNode,
  type ContinuityGraphProjection,
  type ContinuityGraphPromptRelationRef,
} from "./continuityGraphProjection";

type ContinuityGraph = NonNullable<ContinuitySnapshotData["graph"]>;
type ContinuityGraphRelationMode = "all" | "focus";

const NODE_TYPES = { continuityEntity: ContinuityGraphNode };

export function ContinuityGraphMap({
  graph,
  promptRelations,
  anchorLabels,
  selectedEntityUri,
  onEntitySelect,
}: {
  graph: ContinuityGraph;
  promptRelations?: readonly ContinuityGraphPromptRelationRef[];
  anchorLabels?: readonly string[];
  selectedEntityUri?: string;
  onEntitySelect?: (entityUri: string | undefined) => void;
}): JSX.Element | null {
  const [relationMode, setRelationMode] = useState<ContinuityGraphRelationMode>("all");
  const canFocus = Boolean(promptRelations?.length || anchorLabels?.length);
  const projection = useMemo(
    () => projectContinuityGraph({ graph, promptRelations, anchorLabels, selectedEntityUri, relationMode }),
    [anchorLabels, graph, promptRelations, relationMode, selectedEntityUri],
  );

  useEffect(() => {
    if (!canFocus && relationMode === "focus") setRelationMode("all");
  }, [canFocus, relationMode]);

  useEffect(() => {
    if (selectedEntityUri && !projection.nodes.some((node) => node.id === selectedEntityUri)) {
      onEntitySelect?.(undefined);
    }
  }, [onEntitySelect, projection.nodes, selectedEntityUri]);

  if (projection.relationCount === 0) return null;
  return (
    <ReactFlowProvider>
      <ContinuityGraphCanvas
        projection={projection}
        relationMode={relationMode}
        canFocus={canFocus}
        onRelationModeChange={setRelationMode}
        onEntitySelect={onEntitySelect}
      />
    </ReactFlowProvider>
  );
}

function ContinuityGraphCanvas({
  projection,
  relationMode,
  canFocus,
  onRelationModeChange,
  onEntitySelect,
}: {
  projection: ContinuityGraphProjection;
  relationMode: ContinuityGraphRelationMode;
  canFocus: boolean;
  onRelationModeChange: (mode: ContinuityGraphRelationMode) => void;
  onEntitySelect?: (entityUri: string | undefined) => void;
}): JSX.Element {
  const flow = useReactFlow();
  const [ready, setReady] = useState(false);
  const layoutKey = useMemo(
    () =>
      `${projection.nodes.map((node) => node.id).join("\u0001")}\u0002${projection.edges.map((edge) => edge.id).join("\u0001")}`,
    [projection.edges, projection.nodes],
  );
  const fitGraph = useCallback(() => {
    if (projection.nodes.length === 0) return;
    void flow.fitView({ nodes: [...projection.nodes], padding: 0.2, maxZoom: 1.16, duration: 180 });
  }, [flow, projection.nodes]);

  useEffect(() => {
    if (!ready) return;
    const frame = window.requestAnimationFrame(fitGraph);
    return () => window.cancelAnimationFrame(frame);
  }, [fitGraph, layoutKey, ready]);

  return (
    <div
      className="relative h-72 overflow-hidden rounded-lg border border-line-subtle bg-surface-subtle"
      aria-label={frontendMessage("continuity.graphMap")}
      data-continuity-graph-map
      data-testid="continuity-graph-map"
    >
      <ReactFlow
        nodes={[...projection.nodes]}
        edges={[...projection.edges]}
        nodeTypes={NODE_TYPES}
        onlyRenderVisibleElements
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.16 }}
        minZoom={0.45}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        nodesFocusable
        panOnDrag
        panOnScroll={false}
        zoomOnScroll={false}
        zoomOnPinch
        selectionOnDrag={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_event, node) => onEntitySelect?.(node.id)}
        onPaneClick={() => onEntitySelect?.(undefined)}
        onInit={() => setReady(true)}
      >
        <Background variant={BackgroundVariant.Lines} gap={20} size={1} color="var(--theme-canvas-grid)" />
        <Controls
          position="bottom-left"
          showInteractive={false}
          className="!overflow-hidden !rounded-md !border !border-line-subtle !bg-surface-raised !shadow-panel"
        />
      </ReactFlow>
      <div className="absolute left-2 top-2 z-10 max-w-[calc(100%-5rem)]">
        <SegmentedControl
          ariaLabel={frontendMessage("continuity.graph.relationMode")}
          className="min-h-0 !rounded-md !p-0.5 shadow-panel"
          value={relationMode}
          onChange={onRelationModeChange}
          options={[
            { value: "all", label: frontendMessage("continuity.graph.mode.all") },
            { value: "focus", label: frontendMessage("continuity.graph.mode.focus"), disabled: !canFocus },
          ]}
        />
      </div>
      <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md border border-line-subtle bg-surface-raised/92 p-0.5 shadow-panel backdrop-blur-sm">
        <span className="px-1 text-[9.5px] tabular-nums text-content-muted" aria-hidden="true">
          {frontendMessage("continuity.graphMapSummary", {
            entities: projection.entityCount,
            relations: projection.relationCount,
          })}
        </span>
        <IconButton
          label={frontendMessage("continuity.graph.fit")}
          tooltip={frontendMessage("continuity.graph.fit")}
          size="sm"
          tone="muted"
          onClick={fitGraph}
        >
          <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  );
}

function ContinuityGraphNode({ data }: NodeProps<ContinuityGraphFlowNode>): JSX.Element {
  return (
    <div
      className={cn(
        "continuity-graph-node relative w-[164px] overflow-hidden rounded-md border bg-surface-raised px-2.5 py-2 shadow-[var(--theme-node-shadow)]",
        "transition-[border-color,box-shadow,transform] duration-150",
        data.selected ? "border-accent-border-strong shadow-accent" : "border-line-subtle",
      )}
      data-continuity-graph-node
      data-continuity-graph-anchored={data.anchored ? "true" : "false"}
      data-continuity-graph-kind={data.kind}
      data-continuity-graph-selected={data.selected ? "true" : "false"}
      title={data.label}
    >
      <span className="continuity-graph-node__accent absolute inset-x-0 top-0 h-0.5" aria-hidden="true" />
      <Handle
        type="target"
        position={Position.Left}
        className="!h-1.5 !w-1.5 !border-surface-raised !bg-content-muted"
      />
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", data.anchored ? "bg-accent-solid" : "bg-content-muted")}
          aria-hidden="true"
        />
        <p className="min-w-0 flex-1 truncate text-[10.5px] font-medium leading-4 text-content-primary">{data.label}</p>
        <span className="shrink-0 text-[9px] tabular-nums text-content-disabled">{data.degree}</span>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-1.5 !w-1.5 !border-surface-raised !bg-content-muted"
      />
    </div>
  );
}
