import { describe, expect, test } from "vitest";
import {
  AgentExtensionInputDefinitionSchema,
  parseAgentExtensionInputValue,
} from "../../../Source/AgentSystem/Extensions/AgentExtensionInput.js";

describe("MCP input definitions", () => {
  test("validates declared model capabilities and duration presentation against input types", () => {
    const model = {
      id: "model",
      title: "Image model",
      type: "string",
      modelSelection: { valueKind: "model-name", capability: "ImageOutput" },
    };
    expect(AgentExtensionInputDefinitionSchema.parse(model).modelSelection?.capability).toBe("ImageOutput");
    expect(AgentExtensionInputDefinitionSchema.safeParse({ ...model, secret: true }).success).toBe(false);
    expect(
      AgentExtensionInputDefinitionSchema.safeParse({
        ...model,
        modelSelection: { valueKind: "model-name", capability: "unknown" },
      }).success,
    ).toBe(false);
    expect(
      AgentExtensionInputDefinitionSchema.parse({
        id: "timeout",
        title: "Timeout",
        type: "number",
        durationUnit: "milliseconds",
      }).durationUnit,
    ).toBe("milliseconds");
    expect(
      AgentExtensionInputDefinitionSchema.safeParse({
        id: "timeout",
        title: "Timeout",
        type: "string",
        durationUnit: "milliseconds",
      }).success,
    ).toBe(false);
  });
  test("validates multiple choices as unique scalar values", () => {
    const definition = AgentExtensionInputDefinitionSchema.parse({
      id: "regions",
      title: "Regions",
      type: "string",
      multiple: true,
      defaultValue: ["us"],
      choices: ["us", "eu"],
    });

    expect(parseAgentExtensionInputValue(definition, ["us", "eu"])).toEqual(["us", "eu"]);
    expect(() => parseAgentExtensionInputValue(definition, ["unknown"])).toThrow(/declared choices/u);
  });

  test("rejects duplicate or aggregate choices", () => {
    expect(
      AgentExtensionInputDefinitionSchema.safeParse({
        id: "regions",
        title: "Regions",
        type: "string",
        multiple: true,
        choices: ["us", "us"],
      }).success,
    ).toBe(false);
    expect(
      AgentExtensionInputDefinitionSchema.safeParse({
        id: "regions",
        title: "Regions",
        type: "string",
        multiple: true,
        choices: [["us", "eu"]],
      }).success,
    ).toBe(false);
  });
});
