export const AgentPromptContextLayerNames = [
  "kernel",
  "persona",
  "profile",
  "lore",
  "facts",
  "graph",
  "world",
  "scene",
  "memory",
  "workflow",
  "task",
] as const;
export type AgentPromptContextLayerName = (typeof AgentPromptContextLayerNames)[number];

export const AgentPromptContextTierNames = ["stable", "context", "volatile"] as const;
export type AgentPromptContextTierName = (typeof AgentPromptContextTierNames)[number];

export interface AgentPromptContextLayerManifestEntry {
  readonly name: AgentPromptContextLayerName;
  readonly source: "runtime" | "preset" | "profile" | "continuity" | "request";
  readonly stability: "stable" | "turn" | "event";
  readonly included: boolean;
}

/**
 * Revision identities let the prompt path distinguish reusable session context
 * from data that must be rebuilt for the current turn. They are observations,
 * not authorization tokens.
 */
export interface AgentPromptContextRevisions {
  readonly stable: string;
  readonly context: string;
  readonly volatile: string;
}
