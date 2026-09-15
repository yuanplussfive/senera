import {
  AgentTerminalDetailMode,
  type AgentTerminalActivityProjector,
  type AgentTerminalDetailMode as AgentTerminalDetailModeType,
  type AgentTerminalTimelinePatch,
} from "./AgentTerminalActivity.js";
import { AgentTerminalDecisionActivityProjectors } from "./AgentTerminalDecisionActivityProjectors.js";
import { AgentTerminalLifecycleActivityProjectors } from "./AgentTerminalLifecycleActivityProjectors.js";
import type { AgentTerminalActivityProjectorCatalog } from "./AgentTerminalActivityProjectorTypes.js";
import { silentPatch } from "./AgentTerminalActivityProjectorUtils.js";
import { AgentTerminalToolActivityProjectors } from "./AgentTerminalToolActivityProjectors.js";

export interface AgentTerminalActivityProjectorOptions {
  detailMode?: AgentTerminalDetailModeType;
}

const ActivityProjectors: AgentTerminalActivityProjectorCatalog = {
  ...AgentTerminalLifecycleActivityProjectors,
  ...AgentTerminalDecisionActivityProjectors,
  ...AgentTerminalToolActivityProjectors,
};

export function createTerminalActivityProjector(
  options: AgentTerminalActivityProjectorOptions = {},
): AgentTerminalActivityProjector {
  const detailMode = options.detailMode ?? AgentTerminalDetailMode.None;

  return (event, state) => (ActivityProjectors[event.kind] ?? fallbackProjector)(event, state, detailMode);
}

function fallbackProjector(): AgentTerminalTimelinePatch {
  return silentPatch();
}
