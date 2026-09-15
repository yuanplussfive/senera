import type { AgentEventEnvelope } from "../Events/AgentEvent.js";
import type {
  AgentTerminalDetailMode,
  AgentTerminalTimelinePatch,
  AgentTerminalTimelineViewState,
} from "./AgentTerminalActivity.js";

export type AgentTerminalActivityEventProjector = (
  event: AgentEventEnvelope<string, unknown>,
  state: AgentTerminalTimelineViewState,
  detailMode: AgentTerminalDetailMode,
) => AgentTerminalTimelinePatch;

export type AgentTerminalActivityProjectorCatalog = Partial<Record<string, AgentTerminalActivityEventProjector>>;
