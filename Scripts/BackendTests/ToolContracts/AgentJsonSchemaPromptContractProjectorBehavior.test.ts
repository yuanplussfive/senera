import { describe, expect, test } from "vitest";
import { z } from "zod";
import { ensureObjectRootJsonSchema } from "../../../Source/AgentSystem/ToolContracts/AgentJsonSchemaObjectRoot.js";
import { AgentJsonSchemaPromptContractProjector } from "../../../Source/AgentSystem/ToolContracts/AgentJsonSchemaPromptContractProjector.js";

describe("AgentJsonSchemaPromptContractProjector", () => {
  test("preserves fields from mutually exclusive object inputs", () => {
    const input = z.union([
      z
        .object({
          resourceUri: z.string().describe("Use the canonical resource URI."),
          task: z.string().default("describe"),
        })
        .strict(),
      z
        .object({ url: z.string().url().describe("Use the public HTTP(S) URL."), task: z.string().default("describe") })
        .strict(),
    ]);
    const schema = ensureObjectRootJsonSchema(z.toJSONSchema(input, { target: "draft-7", io: "input" }));

    const projection = new AgentJsonSchemaPromptContractProjector().project(schema);

    expect(projection.tsHintLines).toEqual(
      expect.arrayContaining(["  resourceUri?: string", "  url?: string", "  task?: string"]),
    );
    expect(projection.properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "resourceUri", required: false, comment: "Use the canonical resource URI." }),
        expect.objectContaining({ name: "url", required: false, comment: "Use the public HTTP(S) URL." }),
      ]),
    );
  });
});
