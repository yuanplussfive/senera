import { describe, expect, test } from "vitest";
import {
  AgentPiTurnContextElementName,
  isAgentPiTurnContextWireContent,
  mergeAgentPiTurnContext,
  projectAgentPiTurnContext,
} from "../../../Source/AgentSystem/Pi/AgentPiTurnContextMessage.js";

describe("Pi durable turn context", () => {
  test("keeps complete host records beyond the retired character limit", () => {
    const record = JSON.stringify({ note: "x".repeat(14_000), tail: "complete record" });
    const context = projectAgentPiTurnContext({
      turnContext: record,
      skills: [],
      selectedPromptTemplates: [],
    });
    expect(context).toContain(record);
    expect(context).toMatch(/<\/senera_turn_context>$/u);
    expect(context).not.toContain("<scope>");
  });

  test("normalizes inline media without truncating the surrounding context", () => {
    const context = projectAgentPiTurnContext({
      turnContext: '{"image":"data:image/png;base64,aGVsbG8=","end":"still complete"}',
      skills: [],
      selectedPromptTemplates: [],
    });
    expect(context).toContain("[inline media omitted");
    expect(context).not.toContain("aGVsbG8=");
    expect(context).toContain('"end":"still complete"');
  });
  test("merges host context into one user message without a request overlay", () => {
    const context = projectAgentPiTurnContext({
      turnContext: 'senera.live_state=v1\n[senera.scene] encoding=compact-json\n{"activity":"current"}',
      skills: [],
      selectedPromptTemplates: [],
    });
    expect(context).toBeDefined();

    const message = mergeAgentPiTurnContext("Current user task.", context);
    expect(message).toContain(`<${AgentPiTurnContextElementName} protocol="senera.turn-context/v1"`);
    expect(message).toContain("Current user task.");
    expect(message.indexOf("Current user task.")).toBeGreaterThan(message.indexOf("senera.live_state=v1"));
  });

  test("keeps an ordinary user message unchanged when no host context exists", () => {
    expect(mergeAgentPiTurnContext("Current user task.")).toBe("Current user task.");
  });

  test("recognizes the durable context envelope without treating ordinary text as host context", () => {
    expect(
      isAgentPiTurnContextWireContent(`<${AgentPiTurnContextElementName} protocol="senera.turn-context/v1">`),
    ).toBe(true);
    expect(isAgentPiTurnContextWireContent("ordinary user text")).toBe(false);
  });

  test("does not inject Skill bodies into the durable envelope", () => {
    const context = projectAgentPiTurnContext({
      turnContext: "senera.turn=v1",
      skills: [
        {
          name: "example",
          description: "Example skill",
          content: "PRIVATE_SKILL_BODY",
          filePath: "senera://skill/example",
        },
      ],
      selectedPromptTemplates: [],
    });
    expect(context).toContain("example");
    expect(context).not.toContain("PRIVATE_SKILL_BODY");
    expect(context).not.toContain('revision="');
    expect(context).not.toContain("senera://skill/example");
    expect(context).toContain("on-demand");
  });
});
