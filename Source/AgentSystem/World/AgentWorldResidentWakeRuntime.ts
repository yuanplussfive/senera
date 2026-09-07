import { Temporal } from "@js-temporal/polyfill";
import { createOpaqueId } from "../Core/AgentIds.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { AgentWorldActionSourceIds } from "./AgentWorldActionBudget.js";
import { AgentWorldWorkLedger, type AgentWorldWorkItem } from "./AgentWorldWorkLedger.js";
import type {
  AgentWorldScheduleOccurrence,
  AgentWorldWakeInput,
  AgentWorldWakePlan,
  AgentWorldWakeResult,
  AgentWorldWakeSource,
} from "./AgentWorldTypes.js";

export interface AgentWorldResidentWakeRequest {
  readonly id: string;
  readonly reason: string;
  readonly priority: number;
  readonly payload: unknown;
  readonly requestedAt: string;
}

export interface AgentWorldResidentWakeActionInput {
  readonly worldId: string;
  readonly now: Temporal.Instant;
  readonly snapshot: AgentWorldWakeInput["snapshot"];
  readonly request: AgentWorldResidentWakeRequest;
}

export interface AgentWorldResidentWakeActionResult {
  readonly evidenceRefs: readonly string[];
  readonly result?: unknown;
}

export interface AgentWorldResidentWakeActionPort {
  execute(input: AgentWorldResidentWakeActionInput): Promise<AgentWorldResidentWakeActionResult>;
}

/** Explicit, event-driven Resident wake source backed by the shared work ledger. */
export class AgentWorldResidentWakeRuntime implements AgentWorldWakeSource {
  readonly sourceId = AgentWorldActionSourceIds.Resident;
  private readonly leaseOwner: string;

  constructor(
    private readonly options: {
      readonly workLedger: AgentWorldWorkLedger;
      readonly actionPort: AgentWorldResidentWakeActionPort;
      readonly maxPending: number;
      readonly leaseDurationMs: number;
      readonly retryDelayMs: number;
      readonly ownerId?: string;
    },
  ) {
    assertPositiveInteger(options.maxPending, "Resident wake pending limit");
    assertPositiveInteger(options.leaseDurationMs, "Resident wake lease duration");
    assertPositiveInteger(options.retryDelayMs, "Resident wake retry delay");
    const configuredOwner = options.ownerId?.trim();
    this.leaseOwner =
      configuredOwner && configuredOwner.length > 0 ? configuredOwner : createOpaqueId("resident-worker");
  }

  request(input: {
    readonly worldId: string;
    readonly now: string | Temporal.Instant;
    readonly request: Omit<AgentWorldResidentWakeRequest, "requestedAt"> & { readonly requestedAt?: string };
  }): AgentWorldWorkItem {
    const now = normalizeInstant(input.now, "Resident wake request time");
    const request = normalizeRequest({ ...input.request, requestedAt: input.request.requestedAt ?? now });
    return this.options.workLedger.enqueue({
      worldId: input.worldId,
      sourceId: this.sourceId,
      candidateId: request.id,
      requestId: `resident-wake:${input.worldId}:${request.id}`,
      payload: request,
      nextAttemptAt: now,
      now,
    });
  }

  wakePlan(input: { readonly worldId: string; readonly after: Temporal.Instant }): AgentWorldWakePlan {
    const nextDueAt = this.options.workLedger.nextDueAt(input.worldId, this.sourceId);
    if (!nextDueAt) return { due: false, instants: [] };
    const due = Temporal.Instant.from(nextDueAt);
    if (Temporal.Instant.compare(due, input.after) <= 0) return { due: true, instants: [] };
    return { due: false, instants: [due] };
  }

  upcomingSchedules(_input: {
    readonly worldId: string;
    readonly after: Temporal.Instant;
  }): readonly AgentWorldScheduleOccurrence[] {
    return [];
  }

  async onWake(input: AgentWorldWakeInput): Promise<AgentWorldWakeResult> {
    const limit = input.budget ? Math.max(1, input.budget.remainingActions + 1) : this.options.maxPending;
    const due = this.options.workLedger.listDue({
      worldId: input.worldId,
      sourceId: this.sourceId,
      now: input.to,
      limit,
    });
    let changed = false;
    for (const item of due) {
      const request = normalizeRequest(item.payload);
      const admission = input.budget?.admit({
        sourceId: this.sourceId,
        candidateId: request.id,
        kind: "action",
        priority: request.priority,
        conflictKeys: [`resident:${request.id}`],
      });
      if (admission && !admission.admitted) continue;
      const lease = this.options.workLedger.claim({
        id: item.id,
        owner: this.leaseOwner,
        now: input.to,
        leaseUntil: input.to.add({ milliseconds: this.options.leaseDurationMs }),
      });
      if (!lease) continue;
      const running = this.options.workLedger.markRunning({
        id: item.id,
        owner: this.leaseOwner,
        generation: lease.generation,
        now: input.to,
      });
      try {
        const result = await this.options.actionPort.execute({
          worldId: input.worldId,
          now: input.to,
          snapshot: input.snapshot,
          request,
        });
        const evidenceRefs = normalizeEvidenceRefs(result.evidenceRefs);
        this.options.workLedger.ack({
          id: running.item.id,
          owner: this.leaseOwner,
          generation: running.generation,
          now: input.to,
          result: result.result,
          evidenceRefs,
        });
        changed = true;
      } catch (error) {
        input.budget?.defer(this.sourceId);
        this.options.workLedger.fail({
          id: running.item.id,
          owner: this.leaseOwner,
          generation: running.generation,
          now: input.to,
          error: errorMessage(error),
          nextAttemptAt: input.to.add({ milliseconds: this.options.retryDelayMs }),
        });
        throw error;
      }
    }
    if (due.length === limit && input.budget) input.budget.defer(this.sourceId);
    return { changed };
  }
}

function normalizeRequest(value: unknown): AgentWorldResidentWakeRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Resident wake request must be an object.");
  const candidate = value as Partial<AgentWorldResidentWakeRequest>;
  if (typeof candidate.id !== "string" || candidate.id.trim().length === 0)
    throw new Error("Resident wake request id must be non-empty.");
  if (typeof candidate.reason !== "string" || candidate.reason.trim().length === 0)
    throw new Error("Resident wake request reason must be non-empty.");
  if (typeof candidate.priority !== "number" || !Number.isFinite(candidate.priority))
    throw new Error("Resident wake request priority must be finite.");
  return {
    id: candidate.id.trim(),
    reason: candidate.reason.trim(),
    priority: candidate.priority,
    payload: candidate.payload,
    requestedAt: normalizeInstant(candidate.requestedAt ?? "", "Resident wake request timestamp"),
  };
}

function normalizeEvidenceRefs(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Resident wake action evidence references must be an array.");
  return value.map((entry) => {
    if (typeof entry !== "string" || entry.trim().length === 0)
      throw new Error("Resident wake evidence reference must be non-empty.");
    return entry.trim();
  });
}

function normalizeInstant(value: string | Temporal.Instant, label: string): string {
  try {
    return Temporal.Instant.from(value).toString();
  } catch (error) {
    throw new TypeError(`${label} must be a valid Temporal.Instant.`, { cause: error });
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer.`);
}
