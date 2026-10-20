import { describe, expect, test } from "vitest";
import {
  AgentMemOSSemanticIdentityLabels,
  projectAgentMemOSSemanticIdentityDecision,
  projectAgentMemOSSemanticIdentityText,
  projectAgentMemOSSemanticIdentityValue,
} from "../../../Source/AgentSystem/Continuity/AgentMemOSSemanticIdentity.js";

describe("MemOS semantic identity projection", () => {
  const identity = { user: "Ada {{assistant}}", assistant: "Nova <profile>" };

  test("replaces only active profile display values with stable semantic labels", () => {
    expect(
      projectAgentMemOSSemanticIdentityText("Ada {{assistant}} asked Nova <profile> for an update.", identity),
    ).toBe("用户 asked 我 for an update.");
    expect(projectAgentMemOSSemanticIdentityText("External Ada is not a profile match.", identity)).toBe(
      "External Ada is not a profile match.",
    );
  });

  test("projects nested learning context and extracted decisions without touching skip", () => {
    expect(
      projectAgentMemOSSemanticIdentityValue({ note: "Nova <profile> told Ada {{assistant}}." }, identity),
    ).toEqual({
      note: "我 told 用户.",
    });
    expect(
      projectAgentMemOSSemanticIdentityDecision(
        {
          action: "new",
          topic: "Ada {{assistant}} preference",
          summary: "Nova <profile> remembers it.",
          type: "preference",
        },
        identity,
      ),
    ).toEqual({ action: "new", topic: "用户 preference", summary: "我 remembers it.", type: "preference" });
    expect(projectAgentMemOSSemanticIdentityDecision({ action: "skip" }, identity)).toEqual({ action: "skip" });
    expect(AgentMemOSSemanticIdentityLabels).toEqual({ user: "用户", assistant: "我" });
  });
});
