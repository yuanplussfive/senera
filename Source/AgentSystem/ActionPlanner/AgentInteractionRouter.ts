import { InteractionRunMode, type ActionPlanInput, type InteractionRoute } from "../BamlClient/baml_client/types.js";
import { normalizeBamlOptionalFields } from "../BamlClient/AgentBamlOutputNormalizer.js";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import type { ParsedInteractionPreparation } from "./AgentActionPlannerSchema.js";

export const AgentInteractionRunModes = {
  DirectResponse: "direct_response",
  ToolAgentLoop: "tool_agent_loop",
} as const;

export type AgentInteractionRunMode = (typeof AgentInteractionRunModes)[keyof typeof AgentInteractionRunModes];

export interface AgentInteractionRouteResult {
  mode: AgentInteractionRunMode;
  objective: string;
  preferredTools: string[];
  discoveryQueries: string[];
  raw: InteractionRoute;
}

export class AgentInteractionRouter {
  constructor(
    private readonly routeInteraction: (
      input: ActionPlanInput,
      options?: { signal?: AbortSignal },
    ) => Promise<InteractionRoute>,
  ) {}

  async route(input: ActionPlanInput, options: { signal?: AbortSignal } = {}): Promise<AgentInteractionRouteResult> {
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
    preferredTools: [...normalized.preferredTools],
    discoveryQueries: [...normalized.discoveryQueries],
    raw: normalized,
  };
}

export function projectPreparedInteractionRoute(
  preparation: Pick<ParsedInteractionPreparation, "turnUnderstanding" | "initialAction">,
): AgentInteractionRouteResult {
  const toolNames =
    preparation.initialAction.kind === "CallTools"
      ? [...new Set((preparation.initialAction.calls ?? []).map((call) => call.toolName))]
      : [];
  const mode =
    preparation.initialAction.kind === "CallTools"
      ? AgentInteractionRunModes.ToolAgentLoop
      : AgentInteractionRunModes.DirectResponse;
  const rawMode =
    mode === AgentInteractionRunModes.ToolAgentLoop
      ? InteractionRunMode.ToolAgentLoop
      : InteractionRunMode.DirectResponse;
  return {
    mode,
    objective: preparation.turnUnderstanding.standaloneRequest,
    preferredTools: toolNames,
    discoveryQueries: [],
    raw: {
      mode: rawMode,
      objective: preparation.turnUnderstanding.standaloneRequest,
      preferredTools: [...toolNames],
      discoveryQueries: [],
    },
  };
}

function projectInteractionRunMode(mode: InteractionRunMode): AgentInteractionRunMode {
  switch (mode) {
    case InteractionRunMode.DirectResponse:
      return AgentInteractionRunModes.DirectResponse;
    case InteractionRunMode.ToolAgentLoop:
      return AgentInteractionRunModes.ToolAgentLoop;
  }
}
