import { MultiDirectedGraph } from "graphology";
import { bidirectional } from "graphology-shortest-path";
import type { AgentWorldTreeEdge, AgentWorldTreeNode, AgentWorldTreeProjection } from "./AgentWorldTypes.js";

export interface AgentWorldGraphExport {
  readonly nodes: readonly { readonly key: string; readonly attributes: AgentWorldTreeNode }[];
  readonly edges: readonly {
    readonly key: string;
    readonly source: string;
    readonly target: string;
    readonly attributes: AgentWorldTreeEdge;
  }[];
}

/** Ephemeral Graphology index derived from the materialized SQLite-backed world snapshot. */
export class AgentWorldGraphView {
  private readonly graph: MultiDirectedGraph<AgentWorldTreeNode, AgentWorldTreeEdge>;

  constructor(snapshot: AgentWorldTreeProjection) {
    this.graph = new MultiDirectedGraph<AgentWorldTreeNode, AgentWorldTreeEdge>();
    for (const node of snapshot.nodes) this.graph.addNode(node.id, node);
    for (const edge of snapshot.edges) {
      if (!this.graph.hasNode(edge.subjectId) || !this.graph.hasNode(edge.objectId)) continue;
      this.graph.addDirectedEdgeWithKey(edge.id, edge.subjectId, edge.objectId, edge);
    }
  }

  has(entityId: string): boolean {
    return this.graph.hasNode(entityId);
  }

  neighbors(entityId: string): AgentWorldTreeNode[] {
    this.requireNode(entityId);
    return this.graph.neighbors(entityId).map((neighborId) => this.graph.getNodeAttributes(neighborId));
  }

  shortestPath(fromEntityId: string, toEntityId: string): AgentWorldTreeNode[] | undefined {
    this.requireNode(fromEntityId);
    this.requireNode(toEntityId);
    const path = bidirectional(this.graph, fromEntityId, toEntityId);
    return path?.map((entityId) => this.graph.getNodeAttributes(entityId));
  }

  export(): AgentWorldGraphExport {
    const nodes: { key: string; attributes: AgentWorldTreeNode }[] = [];
    const edges: {
      key: string;
      source: string;
      target: string;
      attributes: AgentWorldTreeEdge;
    }[] = [];
    this.graph.forEachNode((key, attributes) => nodes.push({ key, attributes }));
    this.graph.forEachEdge((key, attributes, source, target) => edges.push({ key, source, target, attributes }));
    return { nodes, edges };
  }

  private requireNode(entityId: string): void {
    if (!this.graph.hasNode(entityId)) throw new Error(`World graph entity does not exist: ${entityId}`);
  }
}
