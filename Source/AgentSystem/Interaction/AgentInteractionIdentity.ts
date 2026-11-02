import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import type { AgentInteractionContext } from "./AgentInteractionContext.js";
import type { AgentIdentityDisplayValues } from "../Text/AgentTextParts.js";

/** Host-resolved identity. Native account names and numbers are replaceable bindings. */
export interface AgentInteractionIdentity {
  readonly id: string;
  readonly reference: string;
  readonly kind: "user" | "agent";
  /** Proven historical subject keys; never supplied by the model or a channel payload. */
  readonly legacySubjectIds: readonly string[];
}

/** Undefined means the verified workspace owner; an unknown external name stays empty. */
export function agentInteractionCounterpart(interaction?: AgentInteractionContext): string | undefined {
  if (!interaction || interaction.surface === "console" || interaction.actor?.legacySubjectIds.includes("owner"))
    return undefined;
  return (
    interaction.message?.senderName?.trim() ||
    interaction.event?.actorName?.trim() ||
    interaction.actor?.reference ||
    interaction.message?.senderId ||
    ""
  );
}

export function agentInteractionDisplayValues(
  identity: AgentIdentityDisplayValues | undefined,
  interaction?: AgentInteractionContext,
): AgentIdentityDisplayValues | undefined {
  const user = agentInteractionCounterpart(interaction);
  return identity && user !== undefined ? { ...identity, user } : identity;
}

/** Version-one subject identity, used only to retain proven historical ownership. */
export function agentLegacyInteractionSubject(interaction?: AgentInteractionContext): string {
  if (!interaction || interaction.surface === "console") return "owner";
  return sha256HexOfCanonicalJson({
    platform: interaction.platform,
    profile: interaction.profileId,
    sender: interaction.message?.senderId,
    ...(interaction.message?.senderId ? {} : { space: interaction.spaceId }),
  });
}
