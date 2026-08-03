import { AgentModelTokenEstimator } from "./AgentTextBudget.js";

export interface AgentTurnTokenBudgetOptions {
  readonly model: string;
  readonly contextWindowTokens: number;
  readonly outputReserveTokens: number;
}

export interface AgentToolTokenBudget {
  readonly model: string;
  availableTokens(maximumTokens?: number): number;
}

export class AgentTurnTokenBudget implements AgentToolTokenBudget {
  readonly model: string;
  private readonly estimator: AgentModelTokenEstimator;
  private occupiedTokens = 0;

  constructor(private readonly options: AgentTurnTokenBudgetOptions) {
    this.model = options.model;
    this.estimator = new AgentModelTokenEstimator({ model: options.model });
  }

  observeModelInput(payload: unknown): void {
    const serialized = JSON.stringify(payload);
    this.occupiedTokens = serialized ? this.estimator.estimate(serialized).tokenCount : 0;
  }

  availableTokens(maximumTokens?: number): number {
    const remaining = Math.max(
      1,
      this.options.contextWindowTokens - this.options.outputReserveTokens - this.occupiedTokens,
    );
    return maximumTokens === undefined ? remaining : Math.min(remaining, normalizePositiveInteger(maximumTokens));
  }

  get contextWindowTokens(): number {
    return this.options.contextWindowTokens;
  }

  get outputReserveTokens(): number {
    return this.options.outputReserveTokens;
  }
}

function normalizePositiveInteger(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value));
}
