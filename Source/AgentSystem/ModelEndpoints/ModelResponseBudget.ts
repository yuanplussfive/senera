import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import { AgentBaseError } from "../Core/AgentBaseError.js";

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

export class AgentModelResponseBudgetError extends AgentBaseError {
  constructor(
    readonly limit: "response_bytes" | "event_bytes" | "event_count",
    readonly maximum: number,
    readonly observed: number,
  ) {
    super(`Model response exceeded ${limit}: ${observed} > ${maximum}.`);
  }
}

/** Bounds Pi events without reading or repeatedly serializing their shared partial message. */
export class AgentPiModelResponseBudget {
  private readonly limits;
  private deltaBytes = 0;
  private eventCount = 0;

  constructor(config: AgentModelResponseBudgetConfig) {
    this.limits = resolveAgentModelResponseBudget(config);
  }

  observe(event: AssistantMessageEvent): void {
    this.check("event_count", ++this.eventCount, this.limits.maxSseEvents);
    const payload = "partial" in event ? omitPartial(event) : event;
    this.check("event_bytes", Buffer.byteLength(JSON.stringify(payload)), this.limits.maxSseEventBytes);
    if ("delta" in event) {
      this.deltaBytes += Buffer.byteLength(event.delta);
      this.check("response_bytes", this.deltaBytes, this.limits.maxResponseBytes);
    }
    if (event.type === "done" || event.type === "error") {
      const message = event.type === "done" ? event.message : event.error;
      this.check("response_bytes", Buffer.byteLength(JSON.stringify(message)), this.limits.maxResponseBytes);
    }
  }

  private check(limit: AgentModelResponseBudgetError["limit"], observed: number, maximum: number): void {
    if (observed > maximum) throw new AgentModelResponseBudgetError(limit, maximum, observed);
  }
}

function omitPartial(event: Extract<AssistantMessageEvent, { partial: unknown }>) {
  const { partial: _partial, ...payload } = event;
  return payload;
}
