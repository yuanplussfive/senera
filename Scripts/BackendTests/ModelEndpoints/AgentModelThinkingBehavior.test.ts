import { describe, expect, test } from "vitest";
import { resolveAgentModelThinking } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelThinking.js";

describe("agent model thinking projection", () => {
  test("uses Pi catalog metadata when reasoning was not explicitly configured", () => {
    const projection = resolveAgentModelThinking({
      api: "openai-responses",
      provider: "openai",
      model: "gpt-5.6-luna",
    });

    expect(projection.source).toBe("pi-catalog");
    expect(projection.reasoning).toBe(true);
    expect(projection.levels).toEqual(["off", "low", "medium", "high", "xhigh", "max"]);
  });

  test("does not treat an explicit reasoning disable as enabled", () => {
    const projection = resolveAgentModelThinking({
      api: "openai-responses",
      model: "a-plain-chat-model",
      capabilities: { Reasoning: false },
    });

    expect(projection).toMatchObject({ reasoning: false, levels: ["off"], source: "disabled" });
  });

  test("treats a user profile as an explicit reasoning declaration", () => {
    const projection = resolveAgentModelThinking({
      api: "openai-responses",
      model: "a-plain-chat-model",
      thinkingProfiles: [{ Id: "deep", Label: "Deep", Level: "high" }],
    });

    expect(projection).toMatchObject({ reasoning: true, source: "configuration" });
    expect(projection.profiles).toEqual([{ id: "deep", label: "Deep", level: "high" }]);
  });

  test("preserves an explicit disable and merges user mappings without provider branches", () => {
    const disabled = resolveAgentModelThinking({
      api: "openai-responses",
      model: "gpt-5.6-luna",
      declaredCapabilities: { Reasoning: false },
    });
    expect(disabled).toMatchObject({ reasoning: false, levels: ["off"], defaultLevel: "off" });

    const configured = resolveAgentModelThinking({
      api: "openai-responses",
      model: "gpt-5.6-luna",
      thinkingProfiles: [
        { Id: "balanced", Label: "Balanced", Level: "medium" },
        { Id: "invalid", Label: "Unsupported", Level: "minimal" },
        { Id: "balanced", Label: "Duplicate", Level: "high" },
        { Id: "second-medium", Label: "Second medium", Level: "medium" },
      ],
      defaultThinkingLevel: "minimal",
    });

    expect(configured.source).toBe("configuration");
    expect(configured.levels).toContain("max");
    expect(configured.defaultLevel).toBe("low");
    expect(configured.profiles).toEqual([{ id: "balanced", label: "Balanced", level: "medium" }]);
  });

  test("keeps the catalog lookup stable across provider projections", () => {
    const first = resolveAgentModelThinking({
      api: "openai-responses",
      provider: "openai",
      model: "gpt-5.6-luna",
    });
    const second = resolveAgentModelThinking({
      api: "openai-responses",
      provider: "unknown-senera-endpoint",
      model: "gpt-5.6-luna",
    });

    expect(first.levels).toContain("max");
    expect(second.levels).toEqual(first.levels);
  });
});
