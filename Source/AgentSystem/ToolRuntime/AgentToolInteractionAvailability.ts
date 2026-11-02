import { AgentInteractionSurfaces, type AgentInteractionContext } from "../Interaction/AgentInteractionContext.js";
import type { RegisteredTool } from "../Types/AgentToolRuntimeTypes.js";

/**
 * Surface availability is metadata owned by the tool contract. Tools without
 * an explicit restriction remain available everywhere for backwards
 * compatibility; surface-scoped tools fail closed when called from another
 * interaction surface.
 */
export function isAgentToolAvailableForInteraction(
  tool: Pick<RegisteredTool, "interactionSurfaces" | "interactionPlatforms">,
  interaction?: AgentInteractionContext,
): boolean {
  const surfaces = tool.interactionSurfaces;
  const resolvedInteraction = interaction ?? { surface: AgentInteractionSurfaces.Console };
  if (surfaces && surfaces.length > 0 && !surfaces.includes(resolvedInteraction.surface)) return false;
  const platforms = tool.interactionPlatforms;
  return (
    !platforms ||
    platforms.length === 0 ||
    (resolvedInteraction.platform !== undefined && platforms.includes(resolvedInteraction.platform))
  );
}

export function isAgentToolScopedToInteractionSurface(
  tool: Pick<RegisteredTool, "interactionSurfaces" | "interactionPlatforms">,
  interaction: AgentInteractionContext,
): boolean {
  return (
    tool.interactionSurfaces?.includes(interaction.surface) === true &&
    isAgentToolAvailableForInteraction(tool, interaction)
  );
}
