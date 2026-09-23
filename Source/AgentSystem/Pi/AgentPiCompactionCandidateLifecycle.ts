import type { AgentPiCompactionCandidate } from "./AgentPiCompactionCandidate.js";

/**
 * Runtime-only state for a derived background checkpoint. Pi JSONL remains
 * authoritative; this state makes preparation and handoff observable without
 * persisting a second compaction workflow.
 */
export const AgentPiCompactionCandidatePhases = {
  Idle: "idle",
  Preparing: "preparing",
  Ready: "ready",
  Applying: "applying",
  Failed: "failed",
} as const;

export type AgentPiCompactionCandidatePhase =
  (typeof AgentPiCompactionCandidatePhases)[keyof typeof AgentPiCompactionCandidatePhases];

export const AgentPiCompactionCandidateFailurePhases = {
  Preparation: "preparation",
  Application: "application",
} as const;

export type AgentPiCompactionCandidateFailurePhase =
  (typeof AgentPiCompactionCandidateFailurePhases)[keyof typeof AgentPiCompactionCandidateFailurePhases];

interface AgentPiCompactionCandidateLifecycleSnapshot {
  readonly phase: AgentPiCompactionCandidatePhase;
  readonly updatedAt: string;
  readonly candidateId?: string;
  readonly snapshotLeafId?: string;
  readonly failurePhase?: AgentPiCompactionCandidateFailurePhase;
}

/** Safe, identifier-free status exposed through session runtime inspection. */
export interface AgentPiCompactionCandidateRuntimeStatus {
  readonly phase: AgentPiCompactionCandidatePhase;
  readonly updatedAt: string;
  readonly failurePhase?: AgentPiCompactionCandidateFailurePhase;
}

export class AgentPiCompactionCandidateLifecycle {
  private value: AgentPiCompactionCandidateLifecycleSnapshot;

  constructor(private readonly now: () => string = () => new Date().toISOString()) {
    this.value = { phase: AgentPiCompactionCandidatePhases.Idle, updatedAt: this.now() };
  }

  status(): AgentPiCompactionCandidateRuntimeStatus {
    return {
      phase: this.value.phase,
      updatedAt: this.value.updatedAt,
      ...(this.value.failurePhase ? { failurePhase: this.value.failurePhase } : {}),
    };
  }

  beginPreparation(snapshotLeafId: string): void {
    this.replace({
      phase: AgentPiCompactionCandidatePhases.Preparing,
      snapshotLeafId,
    });
  }

  deferPreparation(snapshotLeafId: string): void {
    if (!this.matchesPreparation(snapshotLeafId)) return;
    this.idle();
  }

  cancelPreparation(snapshotLeafId: string): void {
    if (!this.matchesPreparation(snapshotLeafId)) return;
    this.idle();
  }

  failPreparation(snapshotLeafId: string): void {
    if (!this.matchesPreparation(snapshotLeafId)) return;
    this.replace({
      phase: AgentPiCompactionCandidatePhases.Failed,
      snapshotLeafId,
      failurePhase: AgentPiCompactionCandidateFailurePhases.Preparation,
    });
  }

  markReady(candidate: AgentPiCompactionCandidate): void {
    // A late background completion must not replace the candidate currently
    // being materialized through Pi's append-only compaction operation.
    if (this.value.phase === AgentPiCompactionCandidatePhases.Applying) return;
    this.replace({
      phase: AgentPiCompactionCandidatePhases.Ready,
      candidateId: candidate.id,
      snapshotLeafId: candidate.snapshotLeafId,
    });
  }

  /** Restores persisted candidates when a process recreates a Pi session. */
  adoptReady(candidate: AgentPiCompactionCandidate): void {
    if (this.value.phase === AgentPiCompactionCandidatePhases.Applying) return;
    if (this.value.phase === AgentPiCompactionCandidatePhases.Ready && this.value.candidateId === candidate.id) {
      return;
    }
    this.markReady(candidate);
  }

  /** A deleted or invalidated persisted cache must not leave a stale ready badge. */
  clearStaleReady(): void {
    if (this.value.phase === AgentPiCompactionCandidatePhases.Ready) this.idle();
  }

  beginApplication(candidate: AgentPiCompactionCandidate): void {
    this.replace({
      phase: AgentPiCompactionCandidatePhases.Applying,
      candidateId: candidate.id,
      snapshotLeafId: candidate.snapshotLeafId,
    });
  }

  restoreReady(candidate: AgentPiCompactionCandidate): void {
    if (this.value.phase !== AgentPiCompactionCandidatePhases.Applying || this.value.candidateId !== candidate.id) {
      return;
    }
    this.replace({
      phase: AgentPiCompactionCandidatePhases.Ready,
      candidateId: candidate.id,
      snapshotLeafId: candidate.snapshotLeafId,
    });
  }

  completeApplication(candidateId: string): void {
    if (this.value.phase !== AgentPiCompactionCandidatePhases.Applying || this.value.candidateId !== candidateId) {
      return;
    }
    this.idle();
  }

  failApplication(candidateId: string): boolean {
    if (this.value.phase !== AgentPiCompactionCandidatePhases.Applying || this.value.candidateId !== candidateId) {
      return false;
    }
    this.replace({
      phase: AgentPiCompactionCandidatePhases.Failed,
      candidateId,
      snapshotLeafId: this.value.snapshotLeafId,
      failurePhase: AgentPiCompactionCandidateFailurePhases.Application,
    });
    return true;
  }

  invalidateCandidate(candidateId: string): void {
    if (this.value.candidateId !== candidateId) return;
    this.idle();
  }

  invalidate(): void {
    this.idle();
  }

  private matchesPreparation(snapshotLeafId: string): boolean {
    return (
      this.value.phase === AgentPiCompactionCandidatePhases.Preparing && this.value.snapshotLeafId === snapshotLeafId
    );
  }

  private idle(): void {
    this.replace({ phase: AgentPiCompactionCandidatePhases.Idle });
  }

  private replace(value: Omit<AgentPiCompactionCandidateLifecycleSnapshot, "updatedAt">): void {
    this.value = { ...value, updatedAt: this.now() };
  }
}
