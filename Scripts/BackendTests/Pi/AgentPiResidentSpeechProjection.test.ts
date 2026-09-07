import { describe, expect, test } from "vitest";
import { shouldProjectResidentSpeech } from "../../../Source/AgentSystem/PiShared/AgentPiResidentSpeechProjection.js";
import type { AgentResidentSpeechFocus } from "../../../Source/AgentSystem/ResidentSpeech/AgentResidentSpeechTypes.js";

function focus(mode: AgentResidentSpeechFocus["mode"]): AgentResidentSpeechFocus {
  return { mode, draft: "草稿", actions: [] };
}

const actionPreface = focus("action_preface");
const finalResponse = focus("final_response");

describe("shouldProjectResidentSpeech", () => {
  test("projects action_preface only when the preface rewrite opt-in is enabled", () => {
    const base = {
      focus: actionPreface,
      roleplayPresetActive: true,
      hasRegisteredToolCalls: true,
    };
    expect(shouldProjectResidentSpeech({ ...base, prefaceRewriteEnabled: true })).toBe(true);
    expect(shouldProjectResidentSpeech({ ...base, prefaceRewriteEnabled: false })).toBe(false);
  });

  test("projects final_response only with an active roleplay preset", () => {
    const base = {
      focus: finalResponse,
      prefaceRewriteEnabled: true,
      hasRegisteredToolCalls: true,
    };
    expect(shouldProjectResidentSpeech({ ...base, roleplayPresetActive: true })).toBe(true);
    expect(shouldProjectResidentSpeech({ ...base, roleplayPresetActive: false })).toBe(false);
  });

  test("requires at least one registered tool call for final_response", () => {
    expect(
      shouldProjectResidentSpeech({
        focus: finalResponse,
        prefaceRewriteEnabled: false,
        roleplayPresetActive: true,
        hasRegisteredToolCalls: false,
      }),
    ).toBe(false);
  });

  test("preface rewrite opt-in does not gate final_response", () => {
    expect(
      shouldProjectResidentSpeech({
        focus: finalResponse,
        prefaceRewriteEnabled: false,
        roleplayPresetActive: true,
        hasRegisteredToolCalls: true,
      }),
    ).toBe(true);
  });
});
