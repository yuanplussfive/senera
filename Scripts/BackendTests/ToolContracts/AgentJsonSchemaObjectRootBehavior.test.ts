import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  ensureObjectRootJsonSchema,
  isObjectJsonSchema,
} from "../../../Source/AgentSystem/ToolContracts/AgentJsonSchemaObjectRoot.js";

describe("JSON Schema object roots", () => {
  test("adds the provider-compatible root type without flattening object unions", () => {
    const input = z.discriminatedUnion("action", [
      z.object({ action: z.literal("create"), name: z.string() }).strict(),
      z.object({ action: z.literal("remove"), name: z.string() }).strict(),
    ]);
    const source = z.toJSONSchema(input, { target: "draft-7", io: "input" });
    const projected = ensureObjectRootJsonSchema(source);

    expect(source).not.toHaveProperty("type");
    expect(projected).toMatchObject({ type: "object", oneOf: source.oneOf });
    expect(projected.oneOf).toBe(source.oneOf);
    expect(isObjectJsonSchema(projected)).toBe(true);
  });

  test("accepts an existing object root and rejects non-object input", () => {
    const objectSchema = { type: "object", properties: {} };
    expect(ensureObjectRootJsonSchema(objectSchema)).toBe(objectSchema);
    expect(() => ensureObjectRootJsonSchema({ type: "string" }, "Example")).toThrow(
      'Example schema must have a root type of "object"',
    );
    expect(() => ensureObjectRootJsonSchema({ type: "array", items: {} }, "Example")).toThrow(
      'Example schema must have a root type of "object"',
    );
    expect(() => ensureObjectRootJsonSchema({ oneOf: [{ type: "string" }] }, "Example")).toThrow(
      "Example schema must describe a JSON object at the root",
    );
  });
});
