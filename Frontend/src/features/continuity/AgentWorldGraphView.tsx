import { useEffect, useMemo, useRef, useState } from "react";
import { MultiDirectedGraph } from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { Maximize2 } from "lucide-react";
import type SigmaRenderer from "sigma";
import type { WorldSnapshotData } from "../../api/eventTypes";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import { IconButton } from "../../shared/ui";

type WorldNode = WorldSnapshotData["nodes"][number];

const MinimumLayoutIterations = 36;
const MaximumLayoutIterations = 180;
const LayoutIterationsPerNode = 10;

export function AgentWorldGraphView({ world }: { world: WorldSnapshotData }): JSX.Element | null {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<SigmaRenderer | null>(null);
  const selectedRef = useRef<string | undefined>(undefined);
  const [selected, setSelected] = useState<string>();
  const [renderError, setRenderError] = useState<string>();
  const nodesById = useMemo(() => new Map(world.nodes.map((node) => [node.id, node] as const)), [world.nodes]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || world.nodes.length === 0) return;
    let disposed = false;
    let renderer: SigmaRenderer | undefined;
    const initialize = async (): Promise<void> => {
      if (typeof globalThis.WebGL2RenderingContext === "undefined") {
        setRenderError(frontendMessage("continuity.world.graphUnavailable"));
        return;
      }
      const { default: Sigma } = await import("sigma");
      if (disposed) return;
      const graph = createGraph(world, container);
      renderer = new Sigma(graph, container, {
        allowInvalidContainer: false,
        renderEdgeLabels: true,
        labelRenderedSizeThreshold: 7,
        labelDensity: 0.7,
        labelGridCellSize: 90,
        defaultEdgeType: "arrow",
        nodeReducer: (node, data) => ({
          ...data,
          highlighted: selectedRef.current === node,
          color: selectedRef.current === node ? resolveColor(container, "--color-accent-500") : data.color,
          size: selectedRef.current === node ? Number(data.size) * 1.25 : data.size,
        }),
      });
      rendererRef.current = renderer;
      renderer.on("clickNode", ({ node }) => {
        selectedRef.current = node;
        setSelected(node);
        renderer?.refresh();
      });
      renderer.on("clickStage", () => {
        selectedRef.current = undefined;
        setSelected(undefined);
        renderer?.refresh();
      });
    };
    setRenderError(undefined);
    void initialize().catch((error: unknown) => {
      if (!disposed) setRenderError(error instanceof Error ? error.message : String(error));
    });
    return () => {
      disposed = true;
      renderer?.kill();
      rendererRef.current = null;
    };
  }, [world]);

  if (world.nodes.length === 0) return null;
  const selectedNode = selected ? nodesById.get(selected) : undefined;
  return (
    <div className="space-y-1.5" data-agent-world-graph>
      <div className="relative h-72 overflow-hidden rounded-md border border-line-subtle bg-surface-subtle">
        <div ref={containerRef} className="h-full w-full" aria-label={frontendMessage("continuity.world.graph")} />
        {renderError ? (
          <p className="absolute inset-0 grid place-items-center px-4 text-center text-[10px] leading-4 text-content-muted">
            {renderError}
          </p>
        ) : null}
        <div className="absolute right-2 top-2 rounded-md border border-line-subtle bg-surface-raised/92 p-0.5 shadow-panel backdrop-blur-sm">
          <IconButton
            label={frontendMessage("continuity.graph.fit")}
            tooltip={frontendMessage("continuity.graph.fit")}
            size="sm"
            tone="muted"
            disabled={!rendererRef.current}
            onClick={() => rendererRef.current?.getCamera().animatedReset({ duration: 180 })}
          >
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
          </IconButton>
        </div>
      </div>
      <p className="min-h-4 truncate text-[9.5px] leading-4 text-content-muted">
        {selectedNode
          ? `${selectedNode.label} · ${selectedNode.kind}`
          : frontendMessage("continuity.world.graphSummary", {
              entities: world.nodes.length,
              relations: world.edges.length,
            })}
      </p>
    </div>
  );
}

function createGraph(world: WorldSnapshotData, container: HTMLElement): MultiDirectedGraph {
  const graph = new MultiDirectedGraph();
  const count = world.nodes.length;
  for (const [index, node] of world.nodes.entries()) {
    const angle = (index / count) * Math.PI * 2;
    graph.addNode(node.id, {
      x: Math.cos(angle),
      y: Math.sin(angle),
      size: nodeSize(node, world),
      label: node.label,
      color: nodeColor(node.kind, container),
      forceLabel: node.id === world.resident.residentId || node.id === world.resident.userId,
    });
  }
  for (const edge of world.edges) {
    if (!graph.hasNode(edge.subjectId) || !graph.hasNode(edge.objectId)) continue;
    graph.addDirectedEdgeWithKey(edge.id, edge.subjectId, edge.objectId, {
      label: edge.relationLabel ?? edge.relation,
      color: resolveColor(container, "--color-ink-300"),
      size: edge.confidence ? Math.max(0.5, edge.confidence) : 0.7,
      type: "arrow",
    });
  }
  if (graph.order > 1) {
    const iterations = Math.min(
      MaximumLayoutIterations,
      Math.max(MinimumLayoutIterations, graph.order * LayoutIterationsPerNode),
    );
    forceAtlas2.assign(graph, { iterations, settings: forceAtlas2.inferSettings(graph) });
  }
  return graph;
}

function nodeSize(node: WorldNode, world: WorldSnapshotData): number {
  if (node.id === world.resident.residentId) return 12;
  if (node.id === world.resident.userId) return 10;
  return 6 + Math.min(4, node.children.length);
}

function nodeColor(kind: string, container: HTMLElement): string {
  if (kind === "person" || kind === "organization") return resolveColor(container, "--color-moss-500");
  if (kind === "place" || kind === "artifact" || kind === "item") {
    return resolveColor(container, "--color-umber-500");
  }
  if (kind === "event" || kind === "time" || kind === "goal" || kind === "task") {
    return resolveColor(container, "--color-brick-500");
  }
  return resolveColor(container, "--color-accent-500");
}

function resolveColor(container: HTMLElement, token: string): string {
  const value = getComputedStyle(container).getPropertyValue(token).trim();
  if (!value) throw new Error(`World graph color token is not defined: ${token}`);
  return value.includes(",") || /^\d+\s+\d+\s+\d+$/u.test(value) ? `rgb(${value})` : value;
}
