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

  test("does not treat an empty form map as an explicit reasoning declaration", () => {
    const projection = resolveAgentModelThinking({
      api: "openai-responses",
      model: "a-plain-chat-model",
      thinkingLevelMap: {},
      capabilities: { Reasoning: false },
    });

    expect(projection).toMatchObject({ reasoning: false, levels: ["off"], source: "disabled" });
  });

  test("ignores unknown or blank native map entries instead of enabling reasoning", () => {
    const projection = resolveAgentModelThinking({
      api: "openai-responses",
      model: "a-plain-chat-model",
      thinkingLevelMap: JSON.parse('{"vendorOnly":"custom","high":"  "}'),
      capabilities: { Reasoning: false },
    });

    expect(projection).toMatchObject({ reasoning: false, levels: ["off"], source: "disabled" });
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
      thinkingLevelMap: { max: "ultra" },
      thinkingProfiles: [
        { Id: "balanced", Label: "Balanced", Level: "medium" },
        { Id: "invalid", Label: "Unsupported", Level: "minimal" },
        { Id: "balanced", Label: "Duplicate", Level: "high" },
        { Id: "second-medium", Label: "Second medium", Level: "medium" },
      ],
      defaultThinkingLevel: "minimal",
    });

    expect(configured.source).toBe("configuration");
    expect(configured.thinkingLevelMap?.max).toBe("ultra");
    expect(configured.levels).toContain("max");
    expect(configured.defaultLevel).toBe("low");
    expect(configured.profiles).toEqual([{ id: "balanced", label: "Balanced", level: "medium" }]);
  });

  test("keeps the catalog lookup stable while isolating provider-specific overrides", () => {
    const first = resolveAgentModelThinking({
      api: "openai-responses",
      provider: "openai",
      model: "gpt-5.6-luna",
      thinkingLevelMap: { max: "ultra" },
    });
    const second = resolveAgentModelThinking({
      api: "openai-responses",
      provider: "unknown-senera-endpoint",
      model: "gpt-5.6-luna",
      thinkingLevelMap: { high: null },
    });

    expect(first.levels).toContain("max");
    expect(first.thinkingLevelMap?.max).toBe("ultra");
    expect(second.levels).not.toContain("high");
    expect(second.thinkingLevelMap?.high).toBeNull();
  });
});
