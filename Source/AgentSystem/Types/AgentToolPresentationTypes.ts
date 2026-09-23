import type { AgentExtensionLocalizedText } from "../Extensions/AgentExtensionLocalization.js";

/**
 * Icons are part of the System Tool presentation contract. Keeping the small
 * vocabulary here lets extension manifests, backend events, and the workflow
 * UI agree without a second frontend-only name mapping.
 */
export const AgentToolPresentationIconNames = [
  "tools",
  "search",
  "blocks",
  "file-text",
  "pencil",
  "terminal",
  "clock",
  "activity",
  "git-branch",
  "users",
  "brain",
  "calendar-clock",
  "image",
  "message-question",
  "globe",
] as const;

export type AgentToolPresentationIcon = (typeof AgentToolPresentationIconNames)[number];

/**
 * UI-only metadata carried with a registered tool and its lifecycle events.
 * It deliberately has no bearing on authorization, scheduling, or provider
 * schema exposure.
 */
export interface AgentToolPresentation {
  readonly category: string;
  readonly icon: AgentToolPresentationIcon;
  readonly group: {
    readonly id: string;
    readonly title: AgentExtensionLocalizedText;
  };
  readonly activity: {
    readonly action: AgentExtensionLocalizedText;
    readonly invocationName?: AgentExtensionLocalizedText;
    /** RFC 6901 pointer pattern for the most useful argument preview. */
    readonly argumentPath?: string;
    /** RFC 6901 pointer patterns for supplementary argument previews. */
    readonly detailPaths?: readonly string[];
  };
}

/** A package or Tool contract may refine any inherited domain field. */
export interface AgentToolPresentationOverride {
  readonly category?: string;
  readonly icon?: AgentToolPresentationIcon;
  readonly group?: Partial<AgentToolPresentation["group"]>;
  readonly activity?: Partial<AgentToolPresentation["activity"]>;
}
