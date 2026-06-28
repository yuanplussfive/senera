import {
  AgentCliDetailMode,
  type AgentCliActivityProjector,
  type AgentCliDetailMode as AgentCliDetailModeType,
  type AgentCliTimelinePatch,
} from "./AgentCliActivity.js";
import {
  AgentCliDecisionActivityProjectors,
} from "./AgentCliDecisionActivityProjectors.js";
import {
  AgentCliLifecycleActivityProjectors,
} from "./AgentCliLifecycleActivityProjectors.js";
import type {
  AgentCliActivityProjectorCatalog,
} from "./AgentCliActivityProjectorTypes.js";
import {
  silentPatch,
} from "./AgentCliActivityProjectorUtils.js";
import {
  AgentCliToolActivityProjectors,
} from "./AgentCliToolActivityProjectors.js";

export interface AgentCliActivityProjectorOptions {
  detailMode?: AgentCliDetailModeType;
}

const ActivityProjectors: AgentCliActivityProjectorCatalog = {
  ...AgentCliLifecycleActivityProjectors,
  ...AgentCliDecisionActivityProjectors,
  ...AgentCliToolActivityProjectors,
};

export function createCliActivityProjector(
  options: AgentCliActivityProjectorOptions = {},
): AgentCliActivityProjector {
  const detailMode = options.detailMode ?? AgentCliDetailMode.None;

  return (event, state) => (ActivityProjectors[event.kind] ?? fallbackProjector)(event, state, detailMode);
}

function fallbackProjector(): AgentCliTimelinePatch {
  return silentPatch();
}
