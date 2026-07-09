import type { AgentEventEnvelope } from "../Events/AgentEvent.js";

export const AgentTerminalActivityTone = {
  Progress: "progress",
  Success: "success",
  Warning: "warning",
  Error: "error",
  Neutral: "neutral",
} as const;

export type AgentTerminalActivityTone =
  typeof AgentTerminalActivityTone[keyof typeof AgentTerminalActivityTone];

export const AgentTerminalDetailMode = {
  None: "none",
  Errors: "errors",
  Tools: "tools",
  Xml: "xml",
  All: "all",
} as const;

export type AgentTerminalDetailMode =
  typeof AgentTerminalDetailMode[keyof typeof AgentTerminalDetailMode];

export interface AgentTerminalActivityGroup {
  readonly key: string;
  readonly title: string;
  readonly summary?: string;
}

export interface AgentTerminalActivityView {
  readonly key: string;
  readonly groupKey?: string;
  readonly title: string;
  readonly summary?: string;
  readonly detail?: unknown;
  readonly tone: AgentTerminalActivityTone;
  readonly state?: "active" | "completed";
}

export interface AgentTerminalPreviewView {
  readonly key: string;
  readonly title: string;
  readonly summary: string;
  readonly body: string[];
  readonly tone: AgentTerminalActivityTone;
}

export interface AgentTerminalTimelineViewState {
  readonly groups: Map<string, AgentTerminalActivityGroup>;
  readonly activities: Map<string, AgentTerminalActivityView>;
  readonly activityOrder: string[];
  readonly preview?: AgentTerminalPreviewView;
  readonly decisionXmlByStep: Map<number, string>;
}

export interface AgentTerminalTimelinePatch {
  readonly groups?: AgentTerminalActivityGroup[];
  readonly upserts?: AgentTerminalActivityView[];
  readonly removes?: string[];
  readonly preview?: AgentTerminalPreviewView;
  readonly clearPreview?: boolean;
  readonly silent?: boolean;
}

export type AgentTerminalActivityProjector =
  (
    event: AgentEventEnvelope<string, unknown>,
    state: AgentTerminalTimelineViewState,
  ) => AgentTerminalTimelinePatch;
