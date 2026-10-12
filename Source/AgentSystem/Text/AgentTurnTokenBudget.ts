import { AgentModelTokenEstimator } from "./AgentTextBudget.js";
import { estimateAgentModelInputTokens } from "./AgentMultimodalTokenBudget.js";
import { calculateContextTokens, estimateTokens } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";

export interface AgentTurnTokenBudgetOptions {
  readonly model: string;
  readonly contextWindowTokens: number;
  /** Effective input capacity resolved by the active context policy. */
  readonly inputCapacityTokens?: number;
  /** Dynamic context headroom owned by the caller's compaction policy. */
  readonly windowHeadroomTokens?: number;
  /**
   * Kept as a wire-compatibility alias for older callers. New runtime code
   * must use windowHeadroomTokens; it is never populated from model metadata.
   */
  readonly outputReserveTokens?: number;
}

export interface AgentToolTokenBudget {
  readonly model: string;
  readonly contextWindowTokens?: number;
  readonly windowHeadroomTokens?: number;
  readonly inputCapacityTokens?: number;
  availableTokens(maximumTokens?: number): number;
}

export interface AgentToolTokenReservation extends AgentToolTokenBudget {
  readonly callId: string;
  /** Per-call share before the configured observation ceiling is applied; diagnostics only. */
  readonly batchAllocationTokens: number;
  /** The only token budget that an observation projector may consume. */
  readonly observationBudgetTokens: number;
  commit(payload: unknown): void;
  release(): void;
}

export interface AgentToolBatchReservationInput {
  readonly callIds: readonly string[];
  /** Non-observation data that will be appended with this batch. */
  readonly fixedPayload?: unknown;
}

export interface AgentTurnTokenBudgetSnapshot {
  readonly model: string;
  readonly contextWindowTokens: number;
  readonly windowHeadroomTokens: number;
  readonly outputReserveTokens: number;
  readonly inputCapacityTokens: number;
  readonly occupiedTokens: number;
  readonly availableTokens: number;
  readonly pendingToolReservations: number;
}

export interface AgentModelInputInspection {
  readonly tokenCount: number;
  readonly capacityTokens: number;
  readonly excessTokens: number;
  readonly availableTokens: number;
  readonly fits: boolean;
}

export class AgentModelInputBudgetError extends Error {
  readonly code = "MODEL_INPUT_BUDGET_EXCEEDED";

  constructor(readonly inspection: AgentModelInputInspection) {
    super(formatInputBudgetError(inspection));
    this.name = "AgentModelInputBudgetError";
  }
}

interface ToolReservationState {
  readonly batchAllocationTokens: number;
  claimed: boolean;
  finalized: boolean;
  committedTokens?: number;
}

export class AgentTurnTokenBudget implements AgentToolTokenBudget {
  readonly model: string;
  private readonly estimator: AgentModelTokenEstimator;
  private occupiedTokens = 0;
  private readonly toolReservations = new Map<string, ToolReservationState>();

  constructor(private readonly options: AgentTurnTokenBudgetOptions) {
    this.model = options.model;
    this.estimator = new AgentModelTokenEstimator({ model: options.model });
  }

  validateModelInput(payload: unknown): void {
    this.assertReservationsFinalized();
    this.toolReservations.clear();
    const inspection = this.inspectModelInput(payload);
    this.occupiedTokens = inspection.tokenCount;
    this.assertInputWithinCapacity(inspection);
  }

  /** Measures a complete provider payload without advancing the active input epoch. */
  inspectModelInput(payload: unknown): AgentModelInputInspection {
    return this.inspectTokenCount(this.estimatePayload(payload));
  }

  recordProviderUsage(usage: AssistantMessage["usage"], response: AssistantMessage): void {
    const measuredContextTokens = calculateContextTokens(usage);
    if (measuredContextTokens > 0) {
      this.recordProviderContextTokens(measuredContextTokens);
      return;
    }
    this.recordEstimatedAssistantResponse(response);
  }

  recordProviderContextTokens(contextTokens: number): void {
    const measured = normalizeNonNegativeInteger(contextTokens);
    if (measured > 0) this.occupiedTokens = measured;
  }

  recordEstimatedAssistantResponse(response: AssistantMessage): void {
    this.occupiedTokens += estimateTokens(response);
  }

  reserveToolBatch(input: AgentToolBatchReservationInput): void {
    this.assertReservationsFinalized();
    this.toolReservations.clear();
    const callIds = input.callIds;
    const uniqueCallIds = [...new Set(callIds)];
    if (uniqueCallIds.length !== callIds.length || uniqueCallIds.some((callId) => callId.trim().length === 0)) {
      throw new Error("Pi tool batch contains a missing or duplicate call id.");
    }
    if (uniqueCallIds.length === 0) return;

    const fixedTokens = input.fixedPayload === undefined ? 0 : this.estimatePayload(input.fixedPayload);
    const available = Math.max(0, this.unreservedTokens() - fixedTokens);
    const base = Math.floor(available / uniqueCallIds.length);
    const remainder = available % uniqueCallIds.length;
    for (const [index, callId] of uniqueCallIds.entries()) {
      this.toolReservations.set(callId, {
        // A zero allocation is a pressure signal, not an execution failure.
        // The observation compressor emits a bounded protocol envelope and
        // Pi's own post-turn compaction then takes over.
        batchAllocationTokens: base + (index < remainder ? 1 : 0),
        claimed: false,
        finalized: false,
      });
    }
  }

  claimToolObservation(callId: string, maximumTokens: number): AgentToolTokenReservation {
    const state = this.requireToolReservation(callId);
    if (state.claimed) throw new Error(`Pi tool call ${callId} already claimed its observation budget.`);
    state.claimed = true;
    const observationBudgetTokens = this.toolObservationBudgetTokens(callId, maximumTokens);
    let finalized = false;
    const finalize = (payload?: unknown) => {
      if (finalized) throw new Error(`Pi tool call ${callId} observation budget was already finalized.`);
      this.finalizeToolObservation(state, payload);
      finalized = true;
    };
    return {
      callId,
      batchAllocationTokens: state.batchAllocationTokens,
      observationBudgetTokens,
      model: this.model,
      contextWindowTokens: this.contextWindowTokens,
      windowHeadroomTokens: this.windowHeadroomTokens,
      inputCapacityTokens: this.inputCapacityTokens,
      availableTokens: (maximum) =>
        maximum === undefined
          ? observationBudgetTokens
          : Math.min(observationBudgetTokens, normalizeNonNegativeInteger(maximum)),
      commit: (payload) => finalize(payload),
      release: () => finalize(),
    };
  }

  toolObservationBudgetTokens(callId: string, maximumTokens: number): number {
    return Math.min(
      this.requireToolReservation(callId).batchAllocationTokens,
      normalizeNonNegativeInteger(maximumTokens),
    );
  }

  /** Finalizes terminal Pi outcomes that failed before the execution bridge could claim their reservation. */
  settleToolObservation(callId: string, payload?: unknown): boolean {
    const state = this.requireToolReservation(callId);
    if (state.finalized) return false;
    state.claimed = true;
    this.finalizeToolObservation(state, payload);
    return true;
  }

  availableTokens(maximumTokens?: number): number {
    const remaining = this.unreservedTokens();
    return maximumTokens === undefined ? remaining : Math.min(remaining, normalizeNonNegativeInteger(maximumTokens));
  }

  get contextWindowTokens(): number {
    return this.options.contextWindowTokens;
  }

  get windowHeadroomTokens(): number {
    return this.inputTokenHeadroom();
  }

  get inputCapacityTokens(): number {
    return this.inputTokenCapacity();
  }

  get outputReserveTokens(): number {
    return this.inputTokenHeadroom();
  }

  snapshot(): AgentTurnTokenBudgetSnapshot {
    const inputCapacityTokens = this.inputTokenCapacity();
    return {
      model: this.model,
      contextWindowTokens: this.options.contextWindowTokens,
      windowHeadroomTokens: this.inputTokenHeadroom(),
      outputReserveTokens: this.inputTokenHeadroom(),
      inputCapacityTokens,
      occupiedTokens: this.occupiedTokens,
      availableTokens: Math.max(0, inputCapacityTokens - this.occupiedTokens),
      pendingToolReservations: [...this.toolReservations.values()].filter((reservation) => !reservation.finalized)
        .length,
    };
  }

  private unreservedTokens(): number {
    return Math.max(0, this.inputTokenCapacity() - this.occupiedTokens);
  }

  private inputTokenCapacity(): number {
    if (this.options.inputCapacityTokens !== undefined) {
      return Math.min(
        Math.max(0, normalizeNonNegativeInteger(this.options.contextWindowTokens)),
        normalizeNonNegativeInteger(this.options.inputCapacityTokens),
      );
    }
    return Math.max(0, this.options.contextWindowTokens - this.inputTokenHeadroom());
  }

  private inputTokenHeadroom(): number {
    if (this.options.inputCapacityTokens !== undefined) {
      return Math.max(0, normalizeNonNegativeInteger(this.options.contextWindowTokens) - this.inputTokenCapacity());
    }
    const configured = this.options.windowHeadroomTokens ?? this.options.outputReserveTokens ?? 0;
    return Math.min(this.options.contextWindowTokens, normalizeNonNegativeInteger(configured));
  }

  private requireToolReservation(callId: string): ToolReservationState {
    const state = this.toolReservations.get(callId);
    if (!state) throw new Error(`Pi tool call ${callId} has no observation budget reservation.`);
    return state;
  }

  private finalizeToolObservation(state: ToolReservationState, payload?: unknown): void {
    if (payload !== undefined) {
      const serialized = typeof payload === "string" ? payload : JSON.stringify(payload);
      state.committedTokens = serialized ? this.estimator.estimate(serialized).tokenCount : 0;
    }
    state.finalized = true;
  }

  private estimatePayload(payload: unknown): number {
    return estimateAgentModelInputTokens(this.estimator, payload);
  }

  private inspectTokenCount(tokenCount: number): AgentModelInputInspection {
    const capacityTokens = this.inputTokenCapacity();
    return {
      tokenCount,
      capacityTokens,
      excessTokens: Math.max(0, tokenCount - capacityTokens),
      availableTokens: Math.max(0, capacityTokens - tokenCount),
      fits: tokenCount <= capacityTokens,
    };
  }

  private assertInputWithinCapacity(inspection: AgentModelInputInspection): void {
    if (inspection.fits) return;
    throw new AgentModelInputBudgetError(inspection);
  }

  private assertReservationsFinalized(): void {
    const active = [...this.toolReservations.entries()].filter(([, reservation]) => !reservation.finalized);
    if (active.length === 0) return;
    throw new Error(
      `Pi model input advanced with unfinished tool observations: ${active.map(([id]) => id).join(", ")}.`,
    );
  }
}

function normalizeNonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function formatInputBudgetError(inspection: AgentModelInputInspection): string {
  return `Model input uses ${inspection.tokenCount} tokens, which is ${inspection.excessTokens} over the available input capacity of ${inspection.capacityTokens} tokens.`;
}
