import type { AgentResidentProfileDraft } from "../Profile/AgentResidentProfileTypes.js";
import { residentProfileClaim } from "../Profile/AgentResidentProfileTypes.js";
import type { AgentContinuityObservation } from "./AgentContinuityDomain.js";

export function removeProfileBackedContinuityFacts(input: {
  readonly observations: readonly AgentContinuityObservation[];
  readonly profiles: readonly AgentResidentProfileDraft[];
}): AgentContinuityObservation[] {
  if (input.profiles.length === 0) return [...input.observations];
  return input.observations.filter(
    (observation) => !input.profiles.some((profile) => representsSameClaim(observation, profile)),
  );
}

function representsSameClaim(observation: AgentContinuityObservation, profile: AgentResidentProfileDraft): boolean {
  if (observation.payload.kind !== "fact" || !sameScope(observation.scope, profile.scope)) return false;
  if (!hasSharedSource(observation.sourceRefs, profile.sourceRefs)) return false;
  return isAgentContinuityExactProfileEcho(observation.summary, profile.key, profile.value);
}

/**
 * A profile is a projection, not a license to erase a richer fact. Only an
 * exact canonical echo is redundant; fuzzy/value-overlap comparisons lose the
 * object and conditions that make a fact meaningful.
 */
export function isAgentContinuityExactProfileEcho(
  claim: string,
  profileKey: string,
  profileValue: string | number | boolean,
): boolean {
  return normalize(claim) === normalize(residentProfileClaim(profileKey, profileValue));
}

function sameScope(left: AgentContinuityObservation["scope"], right: AgentResidentProfileDraft["scope"]): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function hasSharedSource(left: readonly string[], right: readonly string[]): boolean {
  const sources = new Set(left);
  return right.some((source) => sources.has(source));
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, "");
}
