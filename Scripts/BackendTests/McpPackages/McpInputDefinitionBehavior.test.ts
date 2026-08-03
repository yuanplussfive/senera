import { describe, expect, test } from "vitest";
import {
  AgentExtensionInputDefinitionSchema,
  parseAgentExtensionInputValue,
} from "../../../Source/AgentSystem/Extensions/AgentExtensionInput.js";

describe("MCP input definitions", () => {
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
