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

export type AgentToolResourceLeaseRequest =
  | {
      readonly mode: "exclusive";
    }
  | {
      readonly mode: "claims";
      readonly claims: readonly AgentToolResourceClaim[];
    };

export function createExactAgentToolResourceClaimDomain(id: string): AgentToolResourceClaimDomain {
  return Object.freeze({
    id,
    overlaps: (left: string, right: string) => left === right,
  });
}
