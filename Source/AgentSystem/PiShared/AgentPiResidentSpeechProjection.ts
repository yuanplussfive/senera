import type { AgentResidentSpeechFocus } from "../ResidentSpeech/AgentResidentSpeechTypes.js";

/**
 * Shared eligibility gate for resident-speech projection used by both the
 * native and BAML Pi tool providers.
 *
 * A projection runs when the model produced a focus the frame wants rewritten:
 * `action_preface` requires the explicit PrefaceRewrite opt-in, while
 * `final_response` requires an active roleplay preset and at least one
 * registered tool call in the turn. Callers narrow the focus before calling.
 */
export function shouldProjectResidentSpeech(input: {
  readonly focus: AgentResidentSpeechFocus;
  readonly prefaceRewriteEnabled: boolean | undefined;
  readonly roleplayPresetActive: boolean | undefined;
  readonly hasRegisteredToolCalls: boolean;
}): boolean {
  const modeEligible =
    input.focus.mode === "action_preface" ? input.prefaceRewriteEnabled === true : input.roleplayPresetActive === true;
  if (!modeEligible) return false;
  if (input.focus.mode === "final_response" && !input.hasRegisteredToolCalls) return false;
  return true;
}
