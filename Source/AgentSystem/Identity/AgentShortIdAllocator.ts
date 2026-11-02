import crypto from "node:crypto";
import { AgentShortIdContract, type AgentIdentityDomain, type AgentShortId } from "./AgentShortId.js";

/** Reservation is atomic in the owning store; a collision never changes an existing identity. */
export function allocateAgentShortId<Domain extends AgentIdentityDomain>(
  domain: Domain,
  reserve: (candidate: AgentShortId<Domain>) => boolean,
  occupied: () => number,
): AgentShortId<Domain> {
  const { alphabet, length } = AgentShortIdContract;
  for (;;) {
    // The alphabet has 32 symbols, which divides 256 without modulo bias.
    const candidate = [...crypto.randomBytes(length)]
      .map((byte) => alphabet[byte % alphabet.length])
      .join("") as AgentShortId<Domain>;
    if (reserve(candidate)) return candidate;
    if (occupied() >= alphabet.length ** length) throw new Error(`The ${domain} identity namespace is exhausted.`);
  }
}
