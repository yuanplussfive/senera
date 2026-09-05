import { AgentEventKinds } from "../Events/AgentEventCatalog.js";
import {
  projectAgentWorldPromptContext,
  projectAgentWorldSnapshotPromptContext,
  type AgentWorldPromptContext,
} from "./AgentWorldPromptContext.js";
import type { AgentWorldSnapshotProvider, AgentWorldTreeProjection } from "./AgentWorldTypes.js";

export interface AgentWorldSnapshotEventData {
  readonly snapshot: AgentWorldPromptContext;
}

export type AgentWorldDomainEvent = {
  readonly kind: typeof AgentEventKinds.WorldSnapshot;
  readonly context: Record<string, never>;
  readonly data: AgentWorldSnapshotEventData;
};

export function createAgentWorldSnapshotEvent(worldRuntime: AgentWorldSnapshotProvider): AgentWorldDomainEvent {
  return {
    kind: AgentEventKinds.WorldSnapshot,
    context: {},
    data: { snapshot: projectAgentWorldPromptContext(worldRuntime) },
  };
}

export function createAgentWorldSnapshotEventFromProjection(snapshot: AgentWorldTreeProjection): AgentWorldDomainEvent {
  return {
    kind: AgentEventKinds.WorldSnapshot,
    context: {},
    data: { snapshot: projectAgentWorldSnapshotPromptContext(snapshot) },
  };
}
