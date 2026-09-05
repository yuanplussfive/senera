/**
 * Runtime-owned interaction context. Only the surface and platform are
 * exposed to the model; channel identifiers remain host-side metadata.
 */
export const AgentInteractionSurfaces = {
  Console: "console",
  Channel: "channel",
} as const;

export type AgentInteractionSurface = (typeof AgentInteractionSurfaces)[keyof typeof AgentInteractionSurfaces];

export type AgentInteractionPlatform = "qq" | "telegram" | "discord";

export type AgentInteractionChatType = "direct" | "group" | "channel" | "thread";

export interface AgentInteractionContext {
  readonly surface: AgentInteractionSurface;
  readonly platform?: AgentInteractionPlatform;
  readonly chatType?: AgentInteractionChatType;
}

/** Keeps callers honest when a channel context is constructed at a boundary. */
export function normalizeAgentInteractionContext(
  context: AgentInteractionContext | undefined,
): AgentInteractionContext | undefined {
  if (!context) return undefined;
  if (context.surface === AgentInteractionSurfaces.Channel && !context.platform) {
    throw new Error("Channel interaction context requires a platform.");
  }
  return {
    surface: context.surface,
    ...(context.platform ? { platform: context.platform } : {}),
    ...(context.chatType ? { chatType: context.chatType } : {}),
  };
}
