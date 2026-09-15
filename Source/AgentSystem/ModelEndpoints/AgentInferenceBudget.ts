import { createOpaqueId } from "../Core/AgentIds.js";
import { stringifyAgentCanonicalJson } from "../Core/AgentCanonicalJson.js";

export const AgentInferenceLaneIds = Object.freeze({
  Foreground: "foreground",
  Goal: "goal",
  Autonomy: "autonomy",
  Resident: "resident",
  Continuity: "continuity",
  Embedding: "embedding",
} as const);
export type AgentInferenceLaneId = (typeof AgentInferenceLaneIds)[keyof typeof AgentInferenceLaneIds];

export interface AgentInferenceBudgetPolicy {
  readonly enabled?: boolean;
  readonly windowMs: number;
  readonly maxRequests: number;
  readonly maxEstimatedInputTokens: number;
  readonly maxEstimatedOutputTokens?: number;
  readonly maxConcurrent?: number;
  readonly foregroundReserveFraction?: number;
  readonly laneWeights?: Readonly<Record<string, number>>;
}

export interface AgentInferenceBudgetRequest {
  readonly scope: string;
  readonly lane: string;
  readonly sourceId: string;
  readonly estimatedInputTokens: number;
  readonly estimatedOutputTokens?: number;
  readonly requestId?: string;
  readonly priority?: number;
}

export interface AgentInferenceBudgetReservation {
  readonly id: string;
  readonly scope: string;
  readonly lane: string;
  readonly sourceId: string;
  readonly requestId?: string;
  readonly estimatedInputTokens: number;
  readonly estimatedOutputTokens: number;
  readonly reservedAtMs: number;
}

export interface AgentInferenceBudgetDecision {
  readonly allowed: boolean;
  readonly retryAtMs?: number;
  readonly reason?: "disabled" | "request_limit" | "input_token_limit" | "output_token_limit" | "concurrency_limit";
  readonly reservation?: AgentInferenceBudgetReservation;
}

export interface AgentInferenceBudgetSettlement {
  readonly reservationId: string;
  readonly actualInputTokens?: number;
  readonly actualOutputTokens?: number;
  readonly completedAtMs?: number;
}

export interface AgentInferenceBudgetPort {
  reserve(input: AgentInferenceBudgetRequest): AgentInferenceBudgetDecision;
  settle(input: AgentInferenceBudgetSettlement): void;
  /** Compatibility admission for embedders that cannot settle usage yet. */
  acquire(input: {
    readonly scope: string;
    readonly estimatedInputTokens: number;
    readonly lane?: string;
    readonly sourceId?: string;
    readonly estimatedOutputTokens?: number;
  }): AgentInferenceBudgetDecision;
}

export function estimateAgentInferenceTokens(input: unknown): number {
  return Math.max(1, Math.ceil(stringifyAgentCanonicalJson(input).length / 4));
}

export function requireAgentInferenceScope(scope: string | undefined): string {
  const normalized = scope?.trim();
  if (!normalized) throw new Error("Inference budget scope must be a non-empty string.");
  return normalized;
}

interface UsageEvent {
  readonly atMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

interface ActiveReservation {
  readonly reservation: AgentInferenceBudgetReservation;
}

interface InferenceWindow {
  events: UsageEvent[];
  active: Map<string, ActiveReservation>;
}

/** Provider-neutral sliding-window admission for model work. */
export class AgentSlidingWindowInferenceBudget implements AgentInferenceBudgetPort {
  private readonly windows = new Map<string, InferenceWindow>();

  constructor(
    private readonly policy: () => AgentInferenceBudgetPolicy,
    private readonly now: () => number = Date.now,
  ) {}

  reserve(input: AgentInferenceBudgetRequest): AgentInferenceBudgetDecision {
    const policy = resolvePolicy(this.policy());
    const request = normalizeRequest(input);
    const nowMs = this.now();
    const window = this.windowFor(request.scope);
    pruneWindow(window, nowMs, policy.windowMs);

    if (policy.enabled === false) {
      return { allowed: false, retryAtMs: nowMs + policy.windowMs, reason: "disabled" };
    }

    const usage = summarizeWindow(window);
    const background = request.lane !== AgentInferenceLaneIds.Foreground;
    const reserveFraction = policy.foregroundReserveFraction ?? 0;
    const requestLimit = background ? Math.floor(policy.maxRequests * (1 - reserveFraction)) : policy.maxRequests;
    const inputLimit = background
      ? Math.floor(policy.maxEstimatedInputTokens * (1 - reserveFraction))
      : policy.maxEstimatedInputTokens;
    const outputLimit =
      policy.maxEstimatedOutputTokens === undefined
        ? undefined
        : background
          ? Math.floor(policy.maxEstimatedOutputTokens * (1 - reserveFraction))
          : policy.maxEstimatedOutputTokens;
    const retryAtMs = nextRetryAt(window, nowMs, policy.windowMs);

    const maxConcurrent = policy.maxConcurrent ?? Number.MAX_SAFE_INTEGER;
    const laneActiveCount = usage.activeByLane.get(request.lane) ?? 0;
    if (
      usage.activeCount >= maxConcurrent ||
      laneActiveCount >= laneConcurrencyLimit(policy, request.lane, maxConcurrent)
    ) {
      return { allowed: false, retryAtMs, reason: "concurrency_limit" };
    }
    if (usage.requestCount + 1 > Math.max(0, requestLimit)) {
      return { allowed: false, retryAtMs, reason: "request_limit" };
    }
    if (usage.inputTokens + request.estimatedInputTokens > Math.max(0, inputLimit)) {
      return { allowed: false, retryAtMs, reason: "input_token_limit" };
    }
    if (outputLimit !== undefined && usage.outputTokens + request.estimatedOutputTokens > Math.max(0, outputLimit)) {
      return { allowed: false, retryAtMs, reason: "output_token_limit" };
    }

    const reservation: AgentInferenceBudgetReservation = {
      id: createOpaqueId("inference-reservation"),
      scope: request.scope,
      lane: request.lane,
      sourceId: request.sourceId,
      ...(request.requestId ? { requestId: request.requestId } : {}),
      estimatedInputTokens: request.estimatedInputTokens,
      estimatedOutputTokens: request.estimatedOutputTokens,
      reservedAtMs: nowMs,
    };
    window.active.set(reservation.id, { reservation });
    return { allowed: true, reservation };
  }

  settle(input: AgentInferenceBudgetSettlement): void {
    const reservationId = input.reservationId.trim();
    if (!reservationId) throw new Error("Inference budget settlement requires a reservation id.");
    const completedAtMs = input.completedAtMs ?? this.now();
    if (!Number.isFinite(completedAtMs)) throw new Error("Inference budget settlement time must be finite.");
    for (const window of this.windows.values()) {
      const active = window.active.get(reservationId);
      if (!active) continue;
      window.active.delete(reservationId);
      window.events.push({
        atMs: completedAtMs,
        inputTokens: normalizeUsage(input.actualInputTokens, active.reservation.estimatedInputTokens),
        outputTokens: normalizeUsage(input.actualOutputTokens, active.reservation.estimatedOutputTokens),
      });
      return;
    }
    throw new Error(`Inference budget reservation was not active: ${reservationId}.`);
  }

  acquire(input: {
    readonly scope: string;
    readonly estimatedInputTokens: number;
    readonly lane?: string;
    readonly sourceId?: string;
    readonly estimatedOutputTokens?: number;
  }): AgentInferenceBudgetDecision {
    const decision = this.reserve({
      scope: input.scope,
      lane: input.lane ?? "background",
      sourceId: input.sourceId ?? "legacy",
      estimatedInputTokens: input.estimatedInputTokens,
      estimatedOutputTokens: input.estimatedOutputTokens,
    });
    if (decision.allowed && decision.reservation) {
      this.settle({
        reservationId: decision.reservation.id,
        actualInputTokens: decision.reservation.estimatedInputTokens,
        actualOutputTokens: decision.reservation.estimatedOutputTokens,
      });
    }
    return decision.allowed
      ? { allowed: true }
      : {
          allowed: false,
          ...(decision.retryAtMs !== undefined ? { retryAtMs: decision.retryAtMs } : {}),
          ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
        };
  }

  clear(scope?: string): void {
    if (scope) this.windows.delete(scope);
    else this.windows.clear();
  }

  private windowFor(scope: string): InferenceWindow {
    const current = this.windows.get(scope);
    if (current) return current;
    const created: InferenceWindow = { events: [], active: new Map() };
    this.windows.set(scope, created);
    return created;
  }
}

export class AgentInferenceBudgetExceededError extends Error {
  constructor(
    readonly retryAtMs: number,
    readonly reason: NonNullable<AgentInferenceBudgetDecision["reason"]>,
  ) {
    super(`Background inference budget exceeded (${reason}); retry at ${new Date(retryAtMs).toISOString()}.`);
    this.name = "AgentInferenceBudgetExceededError";
  }
}

function normalizeRequest(input: AgentInferenceBudgetRequest): AgentInferenceBudgetRequest & {
  readonly estimatedOutputTokens: number;
} {
  const scope = input.scope.trim();
  const lane = input.lane.trim();
  const sourceId = input.sourceId.trim();
  if (!scope) throw new Error("Inference budget scope must not be empty.");
  if (!lane) throw new Error("Inference budget lane must not be empty.");
  if (!sourceId) throw new Error("Inference budget sourceId must not be empty.");
  if (!Number.isSafeInteger(input.estimatedInputTokens) || input.estimatedInputTokens < 1) {
    throw new Error("Inference budget estimatedInputTokens must be a positive safe integer.");
  }
  const estimatedOutputTokens = input.estimatedOutputTokens ?? 0;
  if (!Number.isSafeInteger(estimatedOutputTokens) || estimatedOutputTokens < 0) {
    throw new Error("Inference budget estimatedOutputTokens must be a non-negative safe integer.");
  }
  if (input.priority !== undefined && !Number.isFinite(input.priority)) {
    throw new Error("Inference budget priority must be finite.");
  }
  return { ...input, scope, lane, sourceId, estimatedOutputTokens };
}

function resolvePolicy(input: AgentInferenceBudgetPolicy): AgentInferenceBudgetPolicy {
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") {
    throw new Error("Inference budget enabled flag must be boolean.");
  }
  if (!Number.isSafeInteger(input.windowMs) || input.windowMs < 1) {
    throw new Error("Inference budget windowMs must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(input.maxRequests) || input.maxRequests < 1) {
    throw new Error("Inference budget maxRequests must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(input.maxEstimatedInputTokens) || input.maxEstimatedInputTokens < 1) {
    throw new Error("Inference budget maxEstimatedInputTokens must be a positive safe integer.");
  }
  if (
    input.maxEstimatedOutputTokens !== undefined &&
    (!Number.isSafeInteger(input.maxEstimatedOutputTokens) || input.maxEstimatedOutputTokens < 1)
  ) {
    throw new Error("Inference budget maxEstimatedOutputTokens must be a positive safe integer.");
  }
  if (input.maxConcurrent !== undefined && (!Number.isSafeInteger(input.maxConcurrent) || input.maxConcurrent < 1)) {
    throw new Error("Inference budget maxConcurrent must be a positive safe integer.");
  }
  if (
    input.foregroundReserveFraction !== undefined &&
    (!Number.isFinite(input.foregroundReserveFraction) ||
      input.foregroundReserveFraction < 0 ||
      input.foregroundReserveFraction > 1)
  ) {
    throw new Error("Inference budget foregroundReserveFraction must be between 0 and 1.");
  }
  for (const [lane, weight] of Object.entries(input.laneWeights ?? {})) {
    if (!lane.trim() || !Number.isFinite(weight) || weight <= 0) {
      throw new Error(`Inference budget lane weight must be positive: ${lane}`);
    }
  }
  return input;
}

function nextRetryAt(window: InferenceWindow, nowMs: number, windowMs: number): number {
  const expirations = [
    ...window.events.map((event) => event.atMs + windowMs),
    ...[...window.active.values()].map((item) => item.reservation.reservedAtMs + windowMs),
  ].filter((value) => Number.isFinite(value) && value > nowMs);
  return expirations.length > 0 ? Math.min(...expirations) : nowMs + windowMs;
}

function summarizeWindow(window: InferenceWindow): {
  readonly requestCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly activeCount: number;
  readonly activeByLane: ReadonlyMap<string, number>;
} {
  const activeByLane = new Map<string, number>();
  for (const item of window.active.values()) {
    activeByLane.set(item.reservation.lane, (activeByLane.get(item.reservation.lane) ?? 0) + 1);
  }
  return {
    requestCount: window.events.length + window.active.size,
    inputTokens:
      window.events.reduce((total, event) => total + event.inputTokens, 0) +
      [...window.active.values()].reduce((total, item) => total + item.reservation.estimatedInputTokens, 0),
    outputTokens:
      window.events.reduce((total, event) => total + event.outputTokens, 0) +
      [...window.active.values()].reduce((total, item) => total + item.reservation.estimatedOutputTokens, 0),
    activeCount: window.active.size,
    activeByLane,
  };
}

function laneConcurrencyLimit(policy: AgentInferenceBudgetPolicy, lane: string, maxConcurrent: number): number {
  if (maxConcurrent === Number.MAX_SAFE_INTEGER) return maxConcurrent;
  if (lane === AgentInferenceLaneIds.Foreground) return maxConcurrent;
  const weights = Object.entries(policy.laneWeights ?? {}).filter(
    ([candidate, weight]) => candidate !== AgentInferenceLaneIds.Foreground && Number.isFinite(weight) && weight > 0,
  );
  if (weights.length === 0) return maxConcurrent;
  const maximumWeight = Math.max(...weights.map(([, weight]) => weight));
  const laneWeight = policy.laneWeights?.[lane] ?? Math.min(...weights.map(([, weight]) => weight));
  return Math.min(maxConcurrent, Math.max(1, Math.ceil(maxConcurrent * (laneWeight / maximumWeight))));
}

function pruneWindow(window: InferenceWindow, nowMs: number, windowMs: number): void {
  const cutoff = nowMs - windowMs;
  window.events = window.events.filter((event) => event.atMs > cutoff);
}

function normalizeUsage(value: number | undefined, estimate: number): number {
  if (value === undefined) return estimate;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Inference budget usage must be a non-negative safe integer.");
  }
  return value;
}
