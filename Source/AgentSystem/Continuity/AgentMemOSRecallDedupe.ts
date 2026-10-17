import type { MemOS, MemoryNode, MemOSEvent, ScoredMemory } from "@mem-os/sdk";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { Temporal } from "@js-temporal/polyfill";
import { DefaultAgentTimeZone } from "../Time/AgentTime.js";
import { agentMemOSReference } from "./AgentMemOSReference.js";
import {
  AgentMemOSTags,
  agentMemOSDeliveryKey,
  projectAgentMemOSPeriod,
  projectAgentMemOSOccurredAt,
} from "./AgentMemOSSemanticTypes.js";

export interface AgentMemOSRecallDedupeConfig {
  readonly threshold: number;
  readonly maxPairs: number;
}

interface Coverage {
  readonly versions: readonly string[];
  readonly keys: readonly string[];
}

export interface AgentMemOSRecallDedupeSynchronizeOptions {
  /** Promote a failed background rebuild to an explicit maintenance caller. */
  readonly surfaceFailures?: boolean;
}

/** Read-only native vector grouping. Cached snapshots never merge or delete knowledge. */
export class AgentMemOSRecallDedupe {
  private revision = 0;
  private scannedRevision = -1;
  private scannedConfig = "";
  private task: Promise<void> | undefined;
  private failure: { readonly error: unknown; readonly config: string } | undefined;
  private started = false;
  private stopped = false;
  private groups = new Map<string, Coverage>();
  private readonly events: readonly MemOSEvent[] = [
    "node:created",
    "node:updated",
    "node:deleted",
    "embedding:complete",
    "validity:changed",
    "ttl:expired",
  ];
  private readonly invalidate = () => {
    this.revision += 1;
    this.failure = undefined;
    if (this.started && !this.stopped) this.schedule();
  };

  constructor(
    private readonly options: {
      readonly memos: MemOS;
      readonly namespace: string;
      readonly config: () => AgentMemOSRecallDedupeConfig;
      readonly logger?: AgentLogger;
    },
  ) {
    for (const event of this.events) options.memos.on(event, this.invalidate);
  }

  start(): void {
    this.started = true;
    this.schedule();
  }

  async synchronize(options: AgentMemOSRecallDedupeSynchronizeOptions = {}): Promise<void> {
    if (!this.started) throw new Error("MemOS recall duplicate index is not initialized.");
    if (this.stopped) throw new Error("MemOS recall duplicate index is closed.");
    if (this.failure?.config === JSON.stringify(this.options.config())) {
      if (options.surfaceFailures === true) throw this.failure.error;
      return;
    }
    this.schedule();
    try {
      await this.task;
    } catch (error) {
      // The index is derived state. A failed rebuild leaves the last complete
      // snapshot intact, so foreground recall can continue with that snapshot.
      if (options.surfaceFailures === true) throw error;
    }
  }

  get generation(): number {
    return this.revision;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const event of this.events) this.options.memos.off(event, this.invalidate);
    await this.task;
    if (this.failure) throw this.failure.error;
  }

  project(
    memory: ScoredMemory,
    excluded?: ReadonlySet<string>,
  ): { readonly memory: ScoredMemory; readonly deliveryKeys: readonly string[] } | undefined {
    const node = memory.node;
    const key = agentMemOSDeliveryKey(node);
    if (excluded?.has(key)) return undefined;
    const reference = agentMemOSReference(node.id);
    const coverage = this.groups.get(key);
    // Previously covered identities with changed revisions are new information.
    // Newly created paraphrases of an already covered current version are not.
    if (!excluded?.has(reference) && coverage?.versions.some((version) => excluded?.has(version))) return undefined;
    return { memory, deliveryKeys: coverage?.keys ?? [reference, key] };
  }

  private schedule(): void {
    if (!this.started || this.stopped) return;
    const config = JSON.stringify(this.options.config());
    if (this.task || this.failure?.config === config) return;
    if (this.scannedRevision === this.revision && this.scannedConfig === config) return;
    const task = this.rebuild();
    this.task = task;
    void task.then(
      () => {
        if (this.task === task) this.task = undefined;
        this.schedule();
      },
      (error: unknown) => {
        if (this.task === task) this.task = undefined;
        this.failure = { error, config: JSON.stringify(this.options.config()) };
        this.options.logger?.error("memory.memos.recall_dedupe.failed", { message: errorMessage(error) });
        // Keep the failed promise observable by the next read; never silently bypass deduplication.
      },
    );
  }

  private async rebuild(): Promise<void> {
    // Coalesce a burst of writes and embedding events into one background scan.
    await new Promise<void>((resolve) => setImmediate(resolve));
    do {
      await this.options.memos.flushEmbeddings();
      const revision = this.revision;
      const config = this.options.config();
      const fingerprint = JSON.stringify(config);
      const [result, graph] = await Promise.all([
        this.options.memos.dedupe({ ...config, namespace: this.options.namespace, dryRun: true }),
        this.options.memos.getGraph(),
      ]);
      if (revision !== this.revision || fingerprint !== JSON.stringify(this.options.config())) continue;
      const nodes = new Map(
        graph.nodes.filter((node) => node.namespace === this.options.namespace).map((node) => [node.id, node]),
      );
      const groups = new Map<string, Coverage>();
      for (const merge of result.merges) {
        // Single-linkage clusters can contain weak chains. Reject weak cluster means.
        if (merge.similarity < config.threshold) continue;
        const partitions = new Map<string, MemoryNode[]>();
        for (const id of [merge.kept, ...merge.removed]) {
          const node = nodes.get(id);
          if (!node) continue;
          const scope = duplicateScope(node);
          if (scope === undefined) continue;
          const partition = partitions.get(scope) ?? [];
          partition.push(node);
          partitions.set(scope, partition);
        }
        for (const partition of partitions.values()) {
          if (partition.length < 2) continue;
          const versions = partition.map(agentMemOSDeliveryKey);
          const coverage = { versions, keys: [...partition.map((node) => agentMemOSReference(node.id)), ...versions] };
          for (const version of versions) groups.set(version, coverage);
        }
      }
      this.groups = groups;
      this.scannedRevision = revision;
      this.scannedConfig = fingerprint;
      this.options.logger?.info("memory.memos.recall_dedupe.refreshed", {
        clusters: result.clustersFound,
        coveredVersions: groups.size,
        durationMs: result.durationMs,
      });
    } while (
      !this.stopped &&
      (this.scannedRevision !== this.revision || this.scannedConfig !== JSON.stringify(this.options.config()))
    );
  }
}

/** Use native type and calendar contracts, never text/keyword classification. */
function duplicateScope(node: MemoryNode): string | undefined {
  if (!node.tags.includes(AgentMemOSTags.semantic)) return undefined;
  const period = projectAgentMemOSPeriod(node.tags);
  if (period) return JSON.stringify({ type: node.type, period });
  if (!node.tags.includes(AgentMemOSTags.knowledge)) return undefined;
  return JSON.stringify({
    type: node.type,
    validTo: node.validTo,
    // Native context records describe time-bound episodes; preserve their calendar boundary.
    ...(node.type === "context"
      ? {
          eventDate: Temporal.Instant.from(projectAgentMemOSOccurredAt(node))
            .toZonedDateTimeISO(DefaultAgentTimeZone)
            .toPlainDate()
            .toString(),
        }
      : {}),
  });
}
