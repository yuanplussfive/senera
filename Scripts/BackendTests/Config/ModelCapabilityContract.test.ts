import { describe, expect, test } from "vitest";
import { AgentDefaults } from "../../../Source/AgentSystem/Defaults/AgentDefaultCatalog.js";
import { resolveAgentModelVisionInputCapabilities } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelVisionInputCapabilities.js";
import { ModelCapabilitiesSchema } from "../../../Source/AgentSystem/Schemas/AgentModelConfigSchema.js";
import { validateProviderModelInvariants } from "../../../Source/AgentSystem/Config/AgentProviderModelConfigInvariants.js";
import { resolveAgentModelToolPlanningMode } from "../../../Source/AgentSystem/ModelEndpoints/AgentModelToolPlanning.js";
import { projectSeneraModelProviderToPi } from "../../../Source/AgentSystem/Pi/AgentPiModelProjector.js";
import { createModelProvider } from "../Support/AgentTestFixtures.js";

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

  test("resolves image transport only from the selected model declaration", () => {
    const defaultInput = resolveAgentModelVisionInputCapabilities({});
    expect(defaultInput.supportedMimeTypes).toEqual(["image/jpeg", "image/png", "image/webp"]);
    expect(defaultInput.supportedAnimatedMimeTypes).toBeUndefined();
    expect(
      resolveAgentModelVisionInputCapabilities({
        Capabilities: {
          VisionInput: {
            SupportedMimeTypes: ["image/webp"],
            SupportedAnimatedMimeTypes: ["image/webp"],
            MaxBytes: 1_000_000,
            MaxPixels: 2_000_000,
          },
        },
      }),
    ).toEqual({
      supportedMimeTypes: ["image/webp"],
      supportedAnimatedMimeTypes: ["image/webp"],
      maxBytes: 1_000_000,
      maxPixels: 2_000_000,
    });
  });

  test("requires animated formats to also be valid image transports", () => {
    expect(
      ModelCapabilitiesSchema.safeParse({
        VisionInput: {
          SupportedMimeTypes: ["image/webp"],
          SupportedAnimatedMimeTypes: ["image/apng"],
        },
      }),
    ).toMatchObject({ success: false });

    expect(
      ModelCapabilitiesSchema.parse({
        VisionInput: {
          SupportedMimeTypes: ["image/apng", "image/webp"],
          SupportedAnimatedMimeTypes: ["image/apng"],
        },
      }),
    ).toMatchObject({
      VisionInput: {
        SupportedAnimatedMimeTypes: ["image/apng"],
      },
    });
  });

  test("uses native tool planning as the catalog and resolver default", () => {
    expect(AgentDefaults.ModelRuntime.ToolPlanningMode).toBe("native");
    expect(resolveAgentModelToolPlanningMode({})).toBe("native");
  });

  test("does not choose a fixed model identity for configured runtimes", () => {
    expect(Object.prototype.hasOwnProperty.call(AgentDefaults.ModelRuntime, "Model")).toBe(false);
  });

  test("rejects capabilities outside the provider-independent runtime contract", () => {
    expect(
      ModelCapabilitiesSchema.safeParse({
        ...AgentDefaults.ModelRuntime.Capabilities,
        ProviderNativeTools: true,
      }),
    ).toMatchObject({ success: false });
  });

  test("stores independent model declarations and checks planning requirements only when used", () => {
    const model = {
      Id: "openai/test-model",
      ProviderId: "openai",
      Endpoint: "ChatCompletions" as const,
      Model: "test-model",
    };

    for (const declaration of [
      { ...model, ToolPlanningMode: "native" as const, Capabilities: { ToolCalling: false } },
      { ...model, ToolPlanningMode: "native" as const, Stream: false },
      {
        ...model,
        ToolPlanningMode: "native" as const,
        Stream: false,
        Capabilities: { Chat: false, ImageOutput: true, ToolCalling: false },
      },
    ]) {
      const config = {
        DefaultModelProviderId: "planner",
        ModelProviderEndpoints: [{ Id: "openai", Enabled: true, BaseUrl: "https://provider.example/v1" }],
        ModelProviders: [{ ...model, Id: "planner" }, declaration],
      };
      expect(() => validateProviderModelInvariants(config)).not.toThrow();
      expect(() => validateProviderModelInvariants({ ...config, DefaultModelProviderId: declaration.Id })).toThrow(
        expect.objectContaining({ messageKey: "model.requirementsNotMet" }),
      );
      expect(() => projectSeneraModelProviderToPi(createModelProvider(declaration))).toThrow(
        expect.objectContaining({ messageKey: "model.requirementsNotMet" }),
      );
    }
    expect(() =>
      validateProviderModelInvariants({
        ModelProviders: [{ ...model, ToolPlanningMode: "baml", Stream: false, Capabilities: { ToolCalling: false } }],
      }),
    ).not.toThrow();
  });
});
