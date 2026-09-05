/**
 * Canonical semantic contract for both Pi-native and BAML fact extraction.
 * The prompt transport may differ, but this data is always projected into the
 * model input so the two protocols cannot silently adopt different meanings.
 */
export const AgentContinuityFactCapturePolicy = Object.freeze([
  "Only evidence entries can support a new captured item. Context and referent entries explain meaning, but cannot independently justify a fact, profile, or relation.",
  "Write each fact as one concise, standalone claim in the user's primary language. Preserve named objects, scope, negation, uncertainty, time, place, comparison, and modifiers from the evidence.",
  "A profile is only an explicitly stated, durable, unconditional property of the user. Do not turn a local evaluation, contextual preference, observation, or qualified statement into a global user profile.",
  "When a claim has an object, condition, time, place, comparison, or modifier that changes its meaning, keep the whole qualified claim as a fact. Never split one qualified claim into broader profiles or generic preferences.",
  "When profile and fact classification is uncertain, capture the source-preserving fact and do not create a profile.",
  "Assistant text may clarify what happened in the turn, but it never becomes a user fact, user preference, or verified completion without supporting evidence.",
  "For a relation, copy exactly one id from the registered relation catalog. Do not invent relation ids, storage ids, evidence references, lifetimes, scopes, timestamps, confidence values, or graph identities.",
]);
