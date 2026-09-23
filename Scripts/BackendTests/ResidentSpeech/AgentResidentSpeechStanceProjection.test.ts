import { describe, expect, test } from "vitest";
import { projectAgentResidentSpeechSceneMessage } from "../../../Source/AgentSystem/ResidentSpeech/AgentResidentSpeechPromptProjector.js";
import type {
  AgentResidentSpeechFocus,
  AgentResidentSpeechUtterance,
} from "../../../Source/AgentSystem/ResidentSpeech/AgentResidentSpeechTypes.js";
import type { AgentResidentState } from "../../../Source/AgentSystem/Continuity/AgentResidentState.js";

const focus: AgentResidentSpeechFocus = { mode: "final_response", draft: "我把温湿度发你一份。", actions: [] };
const spoken: AgentResidentSpeechUtterance[] = [{ mode: "action_preface", content: "我去查一下。" }];
const sittingTense: AgentResidentState = { bearing: "wry", mood: "tense", footing: "done", target: "苏州" };

describe("resident speech scene stance projection", () => {
  test("carries the resident stance into the scene evidence when provided", () => {
    const scene = projectAgentResidentSpeechSceneMessage({
      focus,
      spokenUtterances: spoken,
      residentStance: sittingTense,
      lineage: "initial",
      sourceMessages: [],
      timestamp: 10_000,
    });
    const content = typeof scene.content === "string" ? scene.content : "";
    expect(scene.role).toBe("user");
    expect(content).toContain("resident_stance");
    expect(content).toContain("provenance: host-derived");
    expect(content).toContain("tense");
    expect(content).toContain("wry");
    expect(content).toContain("苏州");
  });

  test("omits the resident stance when none is supplied", () => {
    const scene = projectAgentResidentSpeechSceneMessage({
      focus,
      spokenUtterances: spoken,
      lineage: "append",
      sourceMessages: [],
      timestamp: 10_000,
    });
    const content = typeof scene.content === "string" ? scene.content : "";
    expect(content).not.toContain("resident_stance");
  });
});
