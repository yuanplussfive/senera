import { describe, expect, test } from "vitest";
import { resolveAgentResidentSpeechProjection } from "../../../Source/AgentSystem/PiShared/AgentPiResidentSpeechProjection.js";
import type { AgentResidentSpeechFocus } from "../../../Source/AgentSystem/ResidentSpeech/AgentResidentSpeechTypes.js";

function focus(mode: AgentResidentSpeechFocus["mode"]): AgentResidentSpeechFocus {
  return { mode, draft: "草稿", actions: [] };
}

const actionPreface = focus("action_preface");
const finalResponse = focus("final_response");

describe("resolveAgentResidentSpeechProjection", () => {
  test("rewrites action_preface only when its explicit switch is enabled", () => {
    const base = {
      focus: actionPreface,
      personaActive: true,
      finalResponseRewriteEnabled: false,
      hasRegisteredToolCalls: true,
    };
    expect(resolveAgentResidentSpeechProjection({ ...base, prefaceRewriteEnabled: false })).toBeUndefined();
    expect(resolveAgentResidentSpeechProjection({ ...base, prefaceRewriteEnabled: true })).toEqual({ tier: "reshape" });
  });

  test("an active persona selects voice but does not enable final_response rewriting", () => {
    const base = {
      focus: finalResponse,
      prefaceRewriteEnabled: true,
      personaActive: true,
      hasRegisteredToolCalls: true,
    };
    expect(resolveAgentResidentSpeechProjection({ ...base, finalResponseRewriteEnabled: false })).toBeUndefined();
  });

  test("uses the persona voice for an opted-in final response", () => {
    expect(
      resolveAgentResidentSpeechProjection({
        focus: finalResponse,
        prefaceRewriteEnabled: false,
        personaActive: true,
        finalResponseRewriteEnabled: true,
        hasRegisteredToolCalls: true,
      }),
    ).toEqual({ tier: "reshape" });
  });

  test("uses the polish voice without a persona when final rewriting is opted in", () => {
    expect(
      resolveAgentResidentSpeechProjection({
        focus: finalResponse,
        prefaceRewriteEnabled: true,
        personaActive: false,
        finalResponseRewriteEnabled: true,
        hasRegisteredToolCalls: true,
      }),
    ).toEqual({ tier: "polish" });
  });

  test("requires at least one registered tool call for final_response even when the opt-in is enabled", () => {
    expect(
      resolveAgentResidentSpeechProjection({
        focus: finalResponse,
        prefaceRewriteEnabled: false,
        personaActive: true,
        finalResponseRewriteEnabled: true,
        hasRegisteredToolCalls: false,
      }),
    ).toBeUndefined();
  });

  test("preface rewrite does not enable final_response rewriting", () => {
    expect(
      resolveAgentResidentSpeechProjection({
        focus: finalResponse,
        prefaceRewriteEnabled: true,
        personaActive: true,
        finalResponseRewriteEnabled: false,
        hasRegisteredToolCalls: true,
      }),
    ).toBeUndefined();
  });
});
