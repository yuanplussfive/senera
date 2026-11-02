/** Public references share one encoding; their authority always includes a domain. */
export const AgentShortIdContract = {
  alphabet: "0123456789abcdefghjkmnpqrstvwxyz",
  length: 6,
} as const;

export const AgentShortIdPattern = new RegExp(
  `^[${AgentShortIdContract.alphabet}]{${AgentShortIdContract.length}}$`,
  "u",
);

export const AgentIdentityDomains = {
  User: "user",
  Agent: "agent",
  Session: "session",
  Job: "job",
  Resource: "resource",
} as const;

export type AgentIdentityDomain = (typeof AgentIdentityDomains)[keyof typeof AgentIdentityDomains];
declare const identityDomain: unique symbol;
export type AgentShortId<Domain extends AgentIdentityDomain> = string & { readonly [identityDomain]: Domain };

export function isAgentShortId(value: string): boolean {
  return AgentShortIdPattern.test(value);
}

export interface AgentEntityReferences {
  allocate<Domain extends AgentIdentityDomain>(
    domain: Domain,
    entityId: string,
    reference?: string,
  ): AgentShortId<Domain>;
  resolve(domain: AgentIdentityDomain, reference: string): string | undefined;
}
