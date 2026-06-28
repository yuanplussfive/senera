import {
  InteractionRunMode,
  type ActionPlanInput,
  type InteractionRoute,
} from "../BamlClient/baml_client/types.js";
import { normalizeBamlOptionalFields } from "../AgentBamlOutputNormalizer.js";
import { throwIfAborted } from "../AgentCancellation.js";

export const AgentInteractionRunModes = {
  DirectResponse: "direct_response",
  ToolAgentLoop: "tool_agent_loop",
  DeliberateTaskLoop: "deliberate_task_loop",
} as const;

export type AgentInteractionRunMode =
  typeof AgentInteractionRunModes[keyof typeof AgentInteractionRunModes];

export interface AgentInteractionRouteResult {
  mode: AgentInteractionRunMode;
  objective: string;
  needsFreshEvidence: boolean;
  needsWorkspaceRead: boolean;
  needsSideEffect: boolean;
  risk: string;
  preferredTools: string[];
  discoveryQueries: string[];
  reason: string;
  raw: InteractionRoute;
}

export class AgentInteractionRouter {
  constructor(
    private readonly routeInteraction: (
      input: ActionPlanInput,
      options?: { signal?: AbortSignal },
    ) => Promise<InteractionRoute>,
  ) {}

  async route(
    input: ActionPlanInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<AgentInteractionRouteResult> {
    throwIfAborted(options.signal);
    const route = await this.routeInteraction(input, options);
    throwIfAborted(options.signal);
    return projectInteractionRoute(route);
  }
}

export function projectInteractionRoute(route: InteractionRoute): AgentInteractionRouteResult {
  const normalized = normalizeBamlOptionalFields(route);
  return {
    mode: projectInteractionRunMode(normalized.mode),
    objective: normalized.objective,
    needsFreshEvidence: normalized.needsFreshEvidence,
    needsWorkspaceRead: normalized.needsWorkspaceRead,
    needsSideEffect: normalized.needsSideEffect,
    risk: normalized.risk,
    preferredTools: [...normalized.preferredTools],
    discoveryQueries: [...normalized.discoveryQueries],
    reason: normalized.reason,
    raw: normalized,
  };
}

function projectInteractionRunMode(mode: InteractionRunMode): AgentInteractionRunMode {
  switch (mode) {
    case InteractionRunMode.DirectResponse:
      return AgentInteractionRunModes.DirectResponse;
    case InteractionRunMode.ToolAgentLoop:
      return AgentInteractionRunModes.ToolAgentLoop;
    case InteractionRunMode.DeliberateTaskLoop:
      return AgentInteractionRunModes.DeliberateTaskLoop;
  }
}
