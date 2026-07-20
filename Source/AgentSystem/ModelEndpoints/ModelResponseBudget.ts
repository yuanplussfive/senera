export const AgentModelResponseBudgetDefaults = Object.freeze({
  maxResponseBytes: 64 * 1024 * 1024,
  maxSseEventBytes: 8 * 1024 * 1024,
  maxSseEvents: 100_000,
});

export interface AgentModelResponseBudgetConfig {
  readonly MaxResponseBytes?: number;
  readonly MaxSseEventBytes?: number;
  readonly MaxSseEvents?: number;
}

export function resolveAgentModelResponseBudget(config: AgentModelResponseBudgetConfig) {
  return {
    maxResponseBytes: config.MaxResponseBytes ?? AgentModelResponseBudgetDefaults.maxResponseBytes,
    maxSseEventBytes: config.MaxSseEventBytes ?? AgentModelResponseBudgetDefaults.maxSseEventBytes,
    maxSseEvents: config.MaxSseEvents ?? AgentModelResponseBudgetDefaults.maxSseEvents,
  };
}
