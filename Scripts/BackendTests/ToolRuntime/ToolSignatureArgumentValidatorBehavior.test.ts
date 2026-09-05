import { describe, expect, test } from "vitest";
import { AgentJsonSchemaPromptContractProjector } from "../../../Source/AgentSystem/ToolContracts/AgentJsonSchemaPromptContractProjector.js";
import {
  assertToolContractSchema,
  projectAgentToolContractDiagnostics,
  validateToolContractValue,
  validateToolSignatureArguments,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolSignatureArgumentValidator.js";

describe("tool signature argument validator", () => {
  test("projects nested AJV failures into shared pointers and TypeScript-like diagnostics", () => {
    const contract = new AgentJsonSchemaPromptContractProjector().project({
      type: "object",
      properties: {
        location: {
          type: "object",
          properties: {
            city: { type: "string", description: "目标城市。" },
          },
          required: ["city"],
          additionalProperties: false,
        },
      },
      required: ["location"],
      additionalProperties: false,
    });
    const issues = validateToolSignatureArguments({
      contract,
      args: { location: { city: 42, province: "上海" } },
    });
    const diagnostics = projectAgentToolContractDiagnostics(issues, contract);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ keyword: "type", path: ["location", "city"], pointer: "/location/city" }),
        expect.objectContaining({
          keyword: "additionalProperties",
          path: ["location", "province"],
          pointer: "/location/province",
        }),
      ]),
    );
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "type",
          pointer: "/location/city",
          suggestion: "city: string",
          context: expect.objectContaining({
            schemaPointer: expect.stringContaining("/type"),
            contract: expect.objectContaining({ path: "arguments.location.city", description: "目标城市。" }),
          }),
        }),
      ]),
    );
  });

  test("validates MCP contracts that declare the JSON Schema 2020-12 dialect", () => {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "array",
      prefixItems: [{ type: "string" }, { type: "integer" }],
      minItems: 2,
      items: false,
    };

    expect(() => assertToolContractSchema(schema)).not.toThrow();
    expect(validateToolContractValue({ schema, value: ["open_application", 1] })).toEqual([]);
    expect(validateToolContractValue({ schema, value: ["open_application", "not-an-integer"] })).toEqual(
      expect.arrayContaining([expect.objectContaining({ keyword: "type", path: [1] })]),
    );
  });
});
