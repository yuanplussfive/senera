import { Temporal } from "@js-temporal/polyfill";

export const AgentWorldActionSourceIds = Object.freeze({
  Goal: "agenda.goal",
  Autonomy: "world.autonomy",
  Habit: "world.habit",
  Resident: "world.resident",
  ResidentIdle: "world.resident.idle",
  Session: "session",
} as const);

export type AgentWorldActionSourceId = (typeof AgentWorldActionSourceIds)[keyof typeof AgentWorldActionSourceIds];

export type AgentWorldActionCandidateKind = "action" | "decision";

export interface AgentWorldActionCandidate {
  readonly sourceId: string;
  readonly candidateId: string;
  readonly kind: AgentWorldActionCandidateKind;
  readonly priority: number;
  readonly conflictKeys?: readonly string[];
}

export type AgentWorldActionAdmissionReason =
  "admitted" | "global_limit" | "decision_limit" | "source_limit" | "duplicate" | "conflict";

export interface AgentWorldActionAdmission {
  readonly admitted: boolean;
  readonly reason: AgentWorldActionAdmissionReason;
  readonly retryAt?: Temporal.Instant;
}

export interface AgentWorldActionBudgetConfig {
  readonly maxActionsPerWake: number;
  readonly maxDecisionCandidatesPerWake: number;
  readonly retryDelayMs: number;
  readonly fairShare: boolean;
  readonly sourceCaps: Readonly<Record<string, number>>;
}

export interface AgentWorldActionBudgetPort {
  readonly remainingActions: number;
  readonly remainingDecisions: number;
  readonly deferredUntil?: Temporal.Instant;
  readonly hasDeferredWork: boolean;
  admit(candidate: AgentWorldActionCandidate): AgentWorldActionAdmission;
  defer(sourceId: string): Temporal.Instant;
}

/** Deterministic, per-wake admission control shared by every World source. */
export class AgentWorldWakeBudget implements AgentWorldActionBudgetPort {
  private actionCount = 0;
  private decisionCount = 0;
  private readonly sourceCounts = new Map<string, number>();
  private readonly admittedCandidates = new Set<string>();
  private readonly claimedConflicts = new Set<string>();
  private readonly fairShareCap: number | undefined;
  private deferredUntilValue: Temporal.Instant | undefined;

  constructor(
    private readonly config: AgentWorldActionBudgetConfig,
    private readonly now: Temporal.Instant,
    sourceIds: readonly string[],
  ) {
    validatePositiveInteger(config.maxActionsPerWake, "World action budget maxActionsPerWake");
    validatePositiveInteger(config.maxDecisionCandidatesPerWake, "World action budget maxDecisionCandidatesPerWake");
    validatePositiveInteger(config.retryDelayMs, "World action budget retryDelayMs");
    if (!Array.isArray(sourceIds) || sourceIds.some((sourceId) => !sourceId.trim())) {
      throw new Error("World action budget source ids must be non-empty strings.");
    }
    const uniqueSourceCount = new Set(sourceIds).size;
    this.fairShareCap =
      config.fairShare && uniqueSourceCount > 0
        ? Math.max(1, Math.ceil(config.maxActionsPerWake / uniqueSourceCount))
        : undefined;
    for (const [sourceId, cap] of Object.entries(config.sourceCaps)) {
      if (!sourceId.trim()) throw new Error("World action budget source caps require non-empty source ids.");
      validatePositiveInteger(cap, `World action budget source cap ${sourceId}`);
    }
  }

  get remainingActions(): number {
    return Math.max(0, this.config.maxActionsPerWake - this.actionCount);
  }

  get remainingDecisions(): number {
    return Math.max(0, this.config.maxDecisionCandidatesPerWake - this.decisionCount);
  }

  get deferredUntil(): Temporal.Instant | undefined {
    return this.deferredUntilValue;
  }

  get hasDeferredWork(): boolean {
    return this.deferredUntilValue !== undefined;
  }

  admit(candidate: AgentWorldActionCandidate): AgentWorldActionAdmission {
    validateCandidate(candidate);
    const candidateKey = `${candidate.sourceId}\u0000${candidate.candidateId}`;
    if (this.admittedCandidates.has(candidateKey)) return { admitted: false, reason: "duplicate" };
    const conflicts = uniqueNonEmpty(candidate.conflictKeys ?? []);
    if (conflicts.some((key) => this.claimedConflicts.has(key))) {
      return { admitted: false, reason: "conflict" };
    }
    const sourceCap = this.sourceCap(candidate.sourceId);
    if (sourceCap !== undefined && (this.sourceCounts.get(candidate.sourceId) ?? 0) >= sourceCap) {
      return this.deferAdmission("source_limit");
    }
    if (this.actionCount >= this.config.maxActionsPerWake) return this.deferAdmission("global_limit");
    if (candidate.kind === "decision" && this.decisionCount >= this.config.maxDecisionCandidatesPerWake) {
      return this.deferAdmission("decision_limit");
    }
    this.actionCount += 1;
    if (candidate.kind === "decision") this.decisionCount += 1;
    this.sourceCounts.set(candidate.sourceId, (this.sourceCounts.get(candidate.sourceId) ?? 0) + 1);
    this.admittedCandidates.add(candidateKey);
    for (const key of conflicts) this.claimedConflicts.add(key);
    return { admitted: true, reason: "admitted" };
  }

  defer(sourceId: string): Temporal.Instant {
    if (typeof sourceId !== "string" || sourceId.trim().length === 0) {
      throw new Error("World action budget defer requires a non-empty source id.");
    }
    this.deferInternal();
    return this.deferredUntilValue!;
  }

  private sourceCap(sourceId: string): number | undefined {
    const configured = this.config.sourceCaps[sourceId];
    if (configured !== undefined) return configured;
    if (this.fairShareCap === undefined) return undefined;
    return this.fairShareCap;
  }

  private deferAdmission(
    reason: Exclude<AgentWorldActionAdmissionReason, "admitted" | "duplicate" | "conflict">,
  ): AgentWorldActionAdmission {
    this.deferInternal();
    return { admitted: false, reason, retryAt: this.deferredUntilValue };
  }

  private deferInternal(): Temporal.Instant {
    const retryAt = this.now.add({ milliseconds: this.config.retryDelayMs });
    if (!this.deferredUntilValue || Temporal.Instant.compare(retryAt, this.deferredUntilValue) < 0) {
      this.deferredUntilValue = retryAt;
    }
    return this.deferredUntilValue;
  }
}

function validateCandidate(candidate: AgentWorldActionCandidate): void {
  if (!candidate.sourceId.trim()) throw new Error("World action candidate sourceId must not be empty.");
  if (!candidate.candidateId.trim()) throw new Error("World action candidate candidateId must not be empty.");
  if (!Number.isFinite(candidate.priority)) throw new Error("World action candidate priority must be finite.");
}

function validatePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${label} must be a positive safe integer.`);
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
