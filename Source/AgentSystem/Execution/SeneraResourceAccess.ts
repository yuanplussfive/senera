import type { AgentWorkspaceResourceDomain } from "../Core/AgentWorkspaceLayout.js";

export const AgentResourceAccessIntents = {
  Inspect: "inspect",
  Read: "read",
  Create: "create",
  Replace: "replace",
  Remove: "remove",
  Execute: "execute",
} as const;

export type AgentResourceAccessIntent = (typeof AgentResourceAccessIntents)[keyof typeof AgentResourceAccessIntents];

export const AgentResourceAccessAuthorities = {
  Tool: "tool",
  ManagedExtensionPublisher: "managed-extension-publisher",
} as const;

export type AgentResourceAccessAuthority =
  (typeof AgentResourceAccessAuthorities)[keyof typeof AgentResourceAccessAuthorities];

export interface AgentResourceAccessFacts {
  readonly scope: "workspace" | "temporary";
  readonly intent: AgentResourceAccessIntent;
  readonly authority: AgentResourceAccessAuthority;
  readonly domain: AgentWorkspaceResourceDomain;
  readonly domainRoot: boolean;
  readonly relativePath: string;
  readonly containment: "inside" | "outside" | "unknown";
  readonly linkTraversal: "none" | "internal" | "external" | "broken";
  readonly finalEntry: "missing" | "file" | "directory" | "link" | "other" | "unknown";
}

export interface SeneraResourceAccessAuthorizer {
  authorize(resource: AgentResourceAccessFacts): Promise<unknown>;
}
