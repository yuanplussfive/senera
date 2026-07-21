import { createToolContractBundle, z } from "@senera/tool-plugin-sdk";
import { describe, expect, test } from "vitest";

describe("tool plugin SDK contract bundles", () => {
  test("projects deterministic input and output JSON Schemas", () => {
    const definitions = [
      {
        toolName: "Lookup",
        argumentSchema: z
          .object({
            query: z.string().min(1).describe("Search query"),
            limit: z.number().int().positive().optional(),
          })
          .strict(),
        resultSchema: z
          .object({
            matches: z.array(z.string()),
          })
          .strict(),
        execute: () => ({ matches: [] }),
      },
    ] as const;

    const first = createToolContractBundle(definitions, {
      sourceIdentity: "@example/search-plugin@1.0.0",
      sourceFile: "./Schemas.js",
    });
    const second = createToolContractBundle(definitions, {
      sourceIdentity: "@example/search-plugin@1.0.0",
      sourceFile: "./Schemas.js",
    });

    expect(first).toEqual(second);
    expect(Object.isFrozen(first.tools.Lookup?.inputSchema)).toBe(true);
    expect(first.tools.Lookup).toMatchObject({
      source: {
        kind: "schema",
        identity: "@example/search-plugin@1.0.0#Lookup",
        file: "./Schemas.js",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
      inputSchema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        required: ["query"],
        additionalProperties: false,
      },
      outputSchema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        required: ["matches"],
        additionalProperties: false,
      },
    });
  });

  test("rejects duplicate tool names instead of overwriting a contract", () => {
    const definition = {
      toolName: "Duplicate",
      argumentSchema: z.object({}).strict(),
      resultSchema: z.object({}).strict(),
      execute: () => ({}),
    };

    expect(() => createToolContractBundle([definition, definition])).toThrowError(
      "Duplicate tool contract definition: Duplicate",
    );
  });
});
