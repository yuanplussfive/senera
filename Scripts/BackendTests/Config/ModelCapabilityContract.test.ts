import { describe, expect, test } from "vitest";
import { AgentDefaults } from "../../../Source/AgentSystem/Defaults/AgentDefaultCatalog.js";
import { ModelCapabilitiesSchema } from "../../../Source/AgentSystem/Schemas/AgentModelConfigSchema.js";
import { validateProviderModelInvariants } from "../../../Source/AgentSystem/Config/AgentProviderModelConfigInvariants.js";
import { resolveAgentModelToolPlanningMode } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelToolPlanning.js";

describe("Model capability contract", () => {
  test("keeps default capabilities aligned with the strict runtime schema", () => {
    expect(ModelCapabilitiesSchema.parse(AgentDefaults.ModelRuntime.Capabilities)).toEqual(
      AgentDefaults.ModelRuntime.Capabilities,
    );
  });

  test("accepts the provider-independent tool-calling capability", () => {
    expect(
      ModelCapabilitiesSchema.parse({
        ...AgentDefaults.ModelRuntime.Capabilities,
        ToolCalling: false,
      }),
    ).toMatchObject({ ToolCalling: false });
  });

  test("uses native tool planning as the catalog and resolver default", () => {
    expect(AgentDefaults.ModelRuntime.ToolPlanningMode).toBe("native");
    expect(resolveAgentModelToolPlanningMode({})).toBe("native");
  });

  test("rejects capabilities outside the provider-independent runtime contract", () => {
    expect(
      ModelCapabilitiesSchema.safeParse({
        ...AgentDefaults.ModelRuntime.Capabilities,
        ProviderNativeTools: true,
      }),
    ).toMatchObject({ success: false });
  });

  test("rejects invalid native prerequisites while allowing the same capabilities in BAML mode", () => {
    const model = {
      Id: "openai/test-model",
      ProviderId: "openai",
      Endpoint: "ChatCompletions" as const,
      Model: "test-model",
    };

    expect(() =>
      validateProviderModelInvariants({
        ModelProviders: [{ ...model, ToolPlanningMode: "native", Capabilities: { ToolCalling: false } }],
      }),
    ).toThrow(expect.objectContaining({ code: "native_tool_calling_capability_required" }));
    expect(() =>
      validateProviderModelInvariants({
        ModelProviders: [{ ...model, ToolPlanningMode: "native", Stream: false }],
      }),
    ).toThrow(expect.objectContaining({ code: "native_tool_calling_streaming_required" }));
    expect(() =>
      validateProviderModelInvariants({
        ModelProviders: [{ ...model, ToolPlanningMode: "baml", Stream: false, Capabilities: { ToolCalling: false } }],
      }),
    ).not.toThrow();
  });
});
