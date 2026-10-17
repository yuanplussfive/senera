import {
  AgentInteractionSurfaces,
  type AgentInteractionContext,
  type AgentInteractionSurface,
} from "../Interaction/AgentInteractionContext.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";

/**
 * Surface availability is metadata owned by the tool contract. Tools without
 * an explicit restriction remain available everywhere for backwards
 * compatibility; surface-scoped tools fail closed when called from another
 * interaction surface.
 */
export function isAgentToolAvailableForInteraction(
  tool: Pick<RegisteredTool, "interactionSurfaces">,
  interaction?: AgentInteractionContext,
): boolean {
  const surfaces = tool.interactionSurfaces;
  if (!surfaces || surfaces.length === 0) return true;
  return surfaces.includes(interaction?.surface ?? AgentInteractionSurfaces.Console);
}

export function isAgentToolScopedToInteractionSurface(
  tool: Pick<RegisteredTool, "interactionSurfaces">,
  surface: AgentInteractionSurface,
): boolean {
  return tool.interactionSurfaces?.includes(surface) === true;
}
