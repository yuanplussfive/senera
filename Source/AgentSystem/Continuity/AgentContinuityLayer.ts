import {
  createAgentContinuityCheckpoint,
  createAgentContinuityLedger,
  mergeAgentContinuityLedger,
  searchAgentContinuityLedger,
  type AgentContinuityCheckpoint,
  type AgentContinuityCheckpointSelection,
  type AgentContinuityLedger,
  type AgentContinuityLedgerSearchResult,
  type AgentContinuityReference,
  selectAgentContinuityCheckpoint,
} from "./AgentContinuityLedger.js";

/**
 * Request-scoped facade shared by recall, compaction and resume callers. It
 * keeps the durable stores authoritative while making source ingestion and
 * checkpoint selection identical across those callers.
 */
export class AgentContinuityLayer {
  private ledger: AgentContinuityLedger;

  constructor(scope: string, initial?: AgentContinuityLedger) {
    this.ledger = initial ?? createAgentContinuityLedger({ scope });
    if (this.ledger.scope !== scope.trim()) {
      throw new Error(`Continuity scope mismatch: expected ${scope}, received ${this.ledger.scope}.`);
    }
  }

  snapshot(): AgentContinuityLedger {
    return this.ledger;
  }

  ingest(input: {
    readonly references?: readonly AgentContinuityReference[];
    readonly checkpoints?: readonly AgentContinuityCheckpoint[];
  }): AgentContinuityLedger {
    this.ledger = mergeAgentContinuityLedger(
      this.ledger,
      this.ledger.scope,
      input.references ?? [],
      input.checkpoints ?? [],
    );
    return this.ledger;
  }

  compact(limits: { readonly maxReferences: number; readonly maxCheckpoints: number }): AgentContinuityLedger {
    const maxReferences = Math.max(0, Math.floor(limits.maxReferences));
    const maxCheckpoints = Math.max(0, Math.floor(limits.maxCheckpoints));
    const checkpoints: AgentContinuityCheckpoint[] = [];
    const required = new Set<string>();

    // A checkpoint is a restore contract, so its references must survive with
    // it. Select checkpoints newest-first and stop retaining older checkpoints
    // once their references would exceed the bounded reference budget. The
    // newest checkpoint is always retained, even when its own payload is larger
    // than the configured budget; breaking the latest restore point is worse
    // than temporarily exceeding a soft bound.
    for (const checkpoint of [...this.ledger.checkpoints].reverse()) {
      if (checkpoints.length >= maxCheckpoints) break;
      const candidateIds = new Set(checkpoint.referenceIds);
      const candidateSize = new Set([...required, ...candidateIds]).size;
      const budget = checkpoints.length === 0 ? Math.max(maxReferences, candidateSize) : maxReferences;
      if (checkpoints.length === 0 || candidateSize <= budget) {
        checkpoints.push(checkpoint);
        candidateIds.forEach((referenceId) => required.add(referenceId));
      }
    }

    const optional = this.ledger.references
      .filter((reference) => !required.has(reference.id))
      .sort(compareNewestReferences);
    const optionalCapacity = Math.max(0, maxReferences - required.size);
    const references = [
      ...optional.slice(0, optionalCapacity),
      ...this.ledger.references.filter((reference) => required.has(reference.id)),
    ];
    this.ledger = mergeAgentContinuityLedger(undefined, this.ledger.scope, references, checkpoints);
    return this.ledger;
  }

  checkpoint(
    input: Omit<Parameters<typeof createAgentContinuityCheckpoint>[0], "referenceIds"> & {
      readonly referenceIds?: readonly string[];
    },
  ): AgentContinuityCheckpoint | undefined {
    const referenceIds = input.referenceIds ?? this.ledger.references.map((reference) => reference.id);
    if (referenceIds.length === 0) return undefined;
    const checkpoint = createAgentContinuityCheckpoint({ ...input, referenceIds });
    this.ingest({ checkpoints: [checkpoint] });
    return checkpoint;
  }

  recall(query: string, limit?: number): readonly AgentContinuityLedgerSearchResult[] {
    return searchAgentContinuityLedger(this.ledger, query, limit);
  }

  restore(checkpointIdOrSelection?: string | AgentContinuityCheckpointSelection):
    | {
        readonly checkpoint: AgentContinuityCheckpoint;
        readonly references: readonly AgentContinuityReference[];
      }
    | undefined {
    const checkpoint =
      typeof checkpointIdOrSelection === "string"
        ? this.ledger.checkpoints.find((candidate) => candidate.id === checkpointIdOrSelection)
        : selectAgentContinuityCheckpoint(this.ledger.checkpoints, checkpointIdOrSelection);
    return this.restoreCheckpoint(checkpoint);
  }

  private restoreCheckpoint(checkpoint: AgentContinuityCheckpoint | undefined):
    | {
        readonly checkpoint: AgentContinuityCheckpoint;
        readonly references: readonly AgentContinuityReference[];
      }
    | undefined {
    if (!checkpoint) return undefined;
    const referencesById = new Map(this.ledger.references.map((reference) => [reference.id, reference] as const));
    const references = checkpoint.referenceIds.flatMap((referenceId) => {
      const reference = referencesById.get(referenceId);
      return reference ? [reference] : [];
    });
    if (references.length !== checkpoint.referenceIds.length) {
      throw new Error(`Continuity checkpoint ${checkpoint.id} references unavailable sources.`);
    }
    return { checkpoint, references };
  }
}

function compareNewestReferences(left: AgentContinuityReference, right: AgentContinuityReference): number {
  return (
    compareTimestamp(right.createdAt, left.createdAt) ||
    left.kind.localeCompare(right.kind) ||
    left.uri.localeCompare(right.uri) ||
    left.id.localeCompare(right.id)
  );
}

function compareTimestamp(left: string, right: string): number {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs !== rightMs) return leftMs - rightMs;
  return left.localeCompare(right);
}
