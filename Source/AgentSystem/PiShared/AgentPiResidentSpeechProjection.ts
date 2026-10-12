import type { AgentResidentSpeechFocus } from "../ResidentSpeech/AgentResidentSpeechTypes.js";

export interface AgentResidentSpeechProjectionPlan {
  readonly tier: "reshape" | "polish";
}

/** Shared rewrite eligibility and voice selection for both Pi providers. */
export function resolveAgentResidentSpeechProjection(input: {
  readonly focus: AgentResidentSpeechFocus;
  readonly prefaceRewriteEnabled: boolean | undefined;
  readonly personaActive: boolean | undefined;
  readonly finalResponseRewriteEnabled?: boolean | undefined;
  readonly hasRegisteredToolCalls: boolean;
}): AgentResidentSpeechProjectionPlan | undefined {
  const rewriteEnabled =
    input.focus.mode === "action_preface"
      ? input.prefaceRewriteEnabled === true
      : input.finalResponseRewriteEnabled === true;
  if (!rewriteEnabled || (input.focus.mode === "final_response" && !input.hasRegisteredToolCalls)) return undefined;
  return { tier: input.personaActive === true ? "reshape" : "polish" };
}
