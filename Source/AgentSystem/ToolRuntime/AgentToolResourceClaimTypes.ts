export const AgentToolResourceAccessModes = {
  Shared: "shared",
  Exclusive: "exclusive",
} as const;

export type AgentToolResourceAccessMode =
  (typeof AgentToolResourceAccessModes)[keyof typeof AgentToolResourceAccessModes];

export interface AgentToolResourceClaimDomain {
  readonly id: string;
  overlaps(left: string, right: string): boolean;
}

export interface AgentToolResourceClaim {
  readonly domain: AgentToolResourceClaimDomain;
  readonly identity: string;
  readonly access: AgentToolResourceAccessMode;
}

/**
 * Model-facing resource declaration. The declaration is deliberately kept at
 * capability/value level; access mode and overlap semantics remain owned by
 * the registered capability implementation.
 */
export interface AgentToolResourceClaimDeclaration {
  readonly capability: string;
  readonly value: unknown;
  readonly intent?: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
}

export interface AgentToolResourceLeaseRequest {
  readonly mode: "claims";
  readonly claims: readonly AgentToolResourceClaim[];
}

export function createExactAgentToolResourceClaimDomain(id: string): AgentToolResourceClaimDomain {
  return Object.freeze({
    id,
    overlaps: (left: string, right: string) => left === right,
  });
}
