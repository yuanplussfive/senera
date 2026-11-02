import type { AgentEventEnvelope } from "../Events/AgentEventBase.js";

export const AgentSessionInsightsRoute = "/api/session/insights";

/** Compact persisted observations. Message bodies and tool payloads are read through their existing detail paths. */
export interface AgentSessionInsightsPage {
  readonly sessionId: string;
  readonly through: number;
  readonly nextCursor?: number;
  readonly events: readonly AgentEventEnvelope[];
}
