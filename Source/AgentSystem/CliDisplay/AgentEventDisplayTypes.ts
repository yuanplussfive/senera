import type { AgentEventEnvelope } from "../Events/AgentEvent.js";

export type AgentEventDisplayMode = "activity" | "compact" | "verbose";

export interface AgentRenderedEventDisplay {
  label: string;
  message: string;
  tokens: string[];
  details: Record<string, unknown>;
}

export interface AgentCompactEventDisplay {
  message: string;
  tokens?: Array<string | undefined>;
}

export type AgentCompactEventFormatter =
  (event: AgentEventEnvelope<string, unknown>) => AgentCompactEventDisplay;
