import type { AgentChannelMedia, AgentChannelSource } from "./AgentChannelTypes.js";

/**
 * A channel activity is the host's durable boundary between an agent turn and
 * a platform adapter. Resources become publishable only when they are present
 * in this activity; merely being produced by a tool never sends them.
 */
export type AgentChannelActivityPart =
  { readonly kind: "text"; readonly content: string } | { readonly kind: "media"; readonly media: AgentChannelMedia };

export type AgentChannelPublicationIntent =
  | { readonly mode: "none" }
  | {
      readonly mode: "current_turn";
      /** Canonical resource identities selected for this channel turn. */
      readonly resourceUris: readonly string[];
    };

export interface AgentChannelActivity {
  readonly activityId: string;
  readonly source: AgentChannelSource;
  readonly parts: readonly AgentChannelActivityPart[];
  readonly publication: AgentChannelPublicationIntent;
}

export interface AgentChannelActivityPartReceipt {
  readonly index: number;
  readonly status: "sent" | "failed";
  readonly messageIds: readonly string[];
  readonly errorCode?: string;
  readonly retryable?: boolean;
}

export interface AgentChannelActivityDeliveryReceipt {
  readonly status: "sent" | "partial" | "failed";
  readonly activityId: string;
  readonly messageIds: readonly string[];
  readonly parts: readonly AgentChannelActivityPartReceipt[];
  readonly errorCode?: string;
}

export function createAgentChannelActivity(input: {
  readonly activityId: string;
  readonly source: AgentChannelSource;
  readonly parts: readonly AgentChannelActivityPart[];
  readonly publication?: AgentChannelPublicationIntent;
}): AgentChannelActivity {
  // Availability and publication are separate contracts. A producer must opt
  // into the current-turn publication set; creating an activity must never
  // make every discovered Artifact visible on a channel by accident.
  const publication = input.publication ?? { mode: "none" };
  return Object.freeze({
    activityId: input.activityId,
    source: input.source,
    parts: input.parts,
    publication,
  });
}
