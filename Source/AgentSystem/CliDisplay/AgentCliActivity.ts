import type { AgentEventEnvelope } from "../Events/AgentEvent.js";

export const AgentCliActivityTone = {
  Progress: "progress",
  Success: "success",
  Warning: "warning",
  Error: "error",
  Neutral: "neutral",
} as const;

export type AgentCliActivityTone =
  typeof AgentCliActivityTone[keyof typeof AgentCliActivityTone];

export const AgentCliDetailMode = {
  None: "none",
  Errors: "errors",
  Tools: "tools",
  Xml: "xml",
  All: "all",
} as const;

export type AgentCliDetailMode =
  typeof AgentCliDetailMode[keyof typeof AgentCliDetailMode];

export interface AgentCliActivityGroup {
  readonly key: string;
  readonly title: string;
  readonly summary?: string;
}

export interface AgentCliActivityView {
  readonly key: string;
  readonly groupKey?: string;
  readonly title: string;
  readonly summary?: string;
  readonly detail?: unknown;
  readonly tone: AgentCliActivityTone;
  readonly state?: "active" | "completed";
}

export interface AgentCliPreviewView {
  readonly key: string;
  readonly title: string;
  readonly summary: string;
  readonly body: string[];
  readonly tone: AgentCliActivityTone;
}

export interface AgentCliTimelineViewState {
  readonly groups: Map<string, AgentCliActivityGroup>;
  readonly activities: Map<string, AgentCliActivityView>;
  readonly activityOrder: string[];
  readonly preview?: AgentCliPreviewView;
  readonly decisionXmlByStep: Map<number, string>;
}

export interface AgentCliTimelinePatch {
  readonly groups?: AgentCliActivityGroup[];
  readonly upserts?: AgentCliActivityView[];
  readonly removes?: string[];
  readonly preview?: AgentCliPreviewView;
  readonly clearPreview?: boolean;
  readonly silent?: boolean;
}

export type AgentCliActivityProjector =
  (
    event: AgentEventEnvelope<string, unknown>,
    state: AgentCliTimelineViewState,
  ) => AgentCliTimelinePatch;
