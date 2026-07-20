export const AgentResourceAccessIntents = {
  Inspect: "inspect",
  Read: "read",
  Create: "create",
  Replace: "replace",
  Remove: "remove",
  Execute: "execute",
} as const;

export type AgentResourceAccessIntent = (typeof AgentResourceAccessIntents)[keyof typeof AgentResourceAccessIntents];

export interface AgentResourceAccessFacts {
  readonly scope: "workspace" | "temporary";
  readonly intent: AgentResourceAccessIntent;
  readonly relativePath: string;
  readonly containment: "inside" | "outside" | "unknown";
  readonly linkTraversal: "none" | "internal" | "external" | "broken";
  readonly finalEntry: "missing" | "file" | "directory" | "link" | "other" | "unknown";
}

export interface SeneraResourceAccessAuthorizer {
  authorize(resource: AgentResourceAccessFacts): Promise<unknown>;
}
