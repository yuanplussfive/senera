import type { AgentEventEnvelope } from "../Events/AgentEvent.js";
import type {
  AgentCliDetailMode,
  AgentCliTimelinePatch,
  AgentCliTimelineViewState,
} from "./AgentCliActivity.js";

export type AgentCliActivityEventProjector =
  (
    event: AgentEventEnvelope<string, unknown>,
    state: AgentCliTimelineViewState,
    detailMode: AgentCliDetailMode,
  ) => AgentCliTimelinePatch;

export type AgentCliActivityProjectorCatalog = Partial<Record<string, AgentCliActivityEventProjector>>;
