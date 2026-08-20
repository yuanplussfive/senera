import { AgentModelTokenEstimator } from "./AgentTextBudget.js";
import { estimateAgentModelInputTokens } from "./AgentMultimodalTokenBudget.js";

export interface AgentTurnTokenBudgetOptions {
  readonly model: string;
  readonly contextWindowTokens: number;
  readonly outputReserveTokens: number;
}

export interface AgentToolTokenBudget {
  readonly model: string;
  availableTokens(maximumTokens?: number): number;
}

export interface AgentToolTokenReservation extends AgentToolTokenBudget {
  readonly callId: string;
  readonly limit: number;
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
  readonly outputReserveTokens: number;
  readonly inputCapacityTokens: number;
  readonly occupiedTokens: number;
  readonly availableTokens: number;
  readonly pendingToolReservations: number;
}

export interface AgentModelInputInspection {
  readonly tokenCount: number;
  readonly capacityTokens: number;
  readonly availableTokens: number;
  readonly fits: boolean;
}

export interface AgentProjectedModelInput extends AgentModelInputInspection {
  readonly previousTokenCount: number;
  readonly appendedTokenCount: number;
}

interface ToolReservationState {
  readonly allocatedTokens: number;
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

  /**
   * Projects the next provider input from the last measured request and only the
   * messages appended by the completed agent turn.
   */
  projectNextProviderInput(appendedPayload: unknown): AgentProjectedModelInput {
    this.assertReservationsFinalized();
    const appendedTokenCount = this.estimatePayload(appendedPayload);
    const tokenCount = this.occupiedTokens + appendedTokenCount;
    return {
      ...this.inspectTokenCount(tokenCount),
      previousTokenCount: this.occupiedTokens,
      appendedTokenCount,
    };
  }

  /** Replaces the active input epoch after persisted context compaction. */
  rebaseModelInput(payload: unknown): AgentModelInputInspection {
    this.assertReservationsFinalized();
    this.toolReservations.clear();
    const inspection = this.inspectModelInput(payload);
    this.occupiedTokens = inspection.tokenCount;
    this.assertInputWithinCapacity(inspection);
    return inspection;
  }

  recordProviderInputTokens(inputTokens: number): void {
    this.occupiedTokens = Math.max(this.occupiedTokens, normalizeNonNegativeInteger(inputTokens));
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
        allocatedTokens: Math.max(1, base + (index < remainder ? 1 : 0)),
        claimed: false,
        finalized: false,
      });
    }
  }

  claimToolObservation(callId: string, maximumTokens: number): AgentToolTokenReservation {
    const state = this.requireToolReservation(callId);
    if (state.claimed) throw new Error(`Pi tool call ${callId} already claimed its observation budget.`);
    state.claimed = true;
    const limit = this.toolObservationLimit(callId, maximumTokens);
    let finalized = false;
    const finalize = (payload?: unknown) => {
      if (finalized) throw new Error(`Pi tool call ${callId} observation budget was already finalized.`);
      this.finalizeToolObservation(state, payload);
      finalized = true;
    };
    return {
      callId,
      limit,
      model: this.model,
      availableTokens: (maximum) =>
        maximum === undefined ? limit : Math.min(limit, normalizePositiveInteger(maximum)),
      commit: (payload) => finalize(payload),
      release: () => finalize(),
    };
  }

  toolObservationLimit(callId: string, maximumTokens: number): number {
    return Math.min(this.requireToolReservation(callId).allocatedTokens, normalizePositiveInteger(maximumTokens));
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
    return maximumTokens === undefined ? remaining : Math.min(remaining, normalizePositiveInteger(maximumTokens));
  }

  get contextWindowTokens(): number {
    return this.options.contextWindowTokens;
  }

  get outputReserveTokens(): number {
    return this.options.outputReserveTokens;
  }

  snapshot(): AgentTurnTokenBudgetSnapshot {
    const inputCapacityTokens = this.inputTokenCapacity();
    return {
      model: this.model,
      contextWindowTokens: this.options.contextWindowTokens,
      outputReserveTokens: this.options.outputReserveTokens,
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
    return Math.max(0, this.options.contextWindowTokens - this.options.outputReserveTokens);
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
      availableTokens: Math.max(0, capacityTokens - tokenCount),
      fits: tokenCount <= capacityTokens,
    };
  }

  private assertInputWithinCapacity(inspection: AgentModelInputInspection): void {
    if (inspection.fits) return;
    throw new Error(
      `Senera planning input uses ${inspection.tokenCount} tokens but its capacity is ${inspection.capacityTokens}.`,
    );
  }

  private assertReservationsFinalized(): void {
    const active = [...this.toolReservations.entries()].filter(([, reservation]) => !reservation.finalized);
    if (active.length === 0) return;
    throw new Error(
      `Pi model input advanced with unfinished tool observations: ${active.map(([id]) => id).join(", ")}.`,
    );
  }
}

function normalizePositiveInteger(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}

function normalizeNonNegativeInteger(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}
