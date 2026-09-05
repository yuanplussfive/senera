import type { AgentContinuityAuthority } from "./AgentContinuityDomain.js";

const AuthorityRanks: Readonly<Record<AgentContinuityAuthority, number>> = {
  model_inferred: 0,
  system_observed: 1,
  tool_verified: 2,
  user_explicit: 3,
};

export function agentContinuityAuthorityRank(authority: AgentContinuityAuthority): number {
  return AuthorityRanks[authority];
}

export function compareAgentContinuityAuthorities(
  left: AgentContinuityAuthority,
  right: AgentContinuityAuthority,
): number {
  return agentContinuityAuthorityRank(left) - agentContinuityAuthorityRank(right);
}

export function strongestAgentContinuityAuthority(
  left: AgentContinuityAuthority,
  right: AgentContinuityAuthority,
): AgentContinuityAuthority {
  return compareAgentContinuityAuthorities(left, right) >= 0 ? left : right;
}
