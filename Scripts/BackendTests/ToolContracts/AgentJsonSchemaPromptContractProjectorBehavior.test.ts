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

  test("expands a discriminated union inside an array element", () => {
    const input = z.object({
      operations: z.array(
        z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("add"), path: z.string(), content: z.string() }).strict(),
          z.object({ kind: z.literal("update"), path: z.string(), oldStr: z.string(), newStr: z.string() }).strict(),
          z.object({ kind: z.literal("write"), path: z.string(), content: z.string() }).strict(),
          z.object({ kind: z.literal("delete"), path: z.string() }).strict(),
          z.object({ kind: z.literal("move"), source: z.string(), destination: z.string() }).strict(),
        ]),
      ),
    });
    const schema = ensureObjectRootJsonSchema(z.toJSONSchema(input, { target: "draft-7", io: "input" }));

    const projection = new AgentJsonSchemaPromptContractProjector().project(schema);

    const operations = projection.properties.find((property) => property.name === "operations");
    expect(operations?.kind).toBe("array");
    expect(operations?.element).toBeDefined();
    const element = operations!.element!;
    expect(element.kind).toBe("object");
    expect(element.children.map((child) => child.name)).toEqual([
      "kind",
      "path",
      "content",
      "oldStr",
      "newStr",
      "source",
      "destination",
    ]);
    const kind = element.children.find((child) => child.name === "kind");
    expect(kind?.kind).toBe("scalar");
    expect(kind?.typeText).toBe('"add" | "update" | "write" | "delete" | "move"');
    expect(kind?.required).toBe(true);
    const path = element.children.find((child) => child.name === "path");
    expect(path?.typeText).toBe("string");
    expect(path?.required).toBe(false);
    expect(element.children.find((child) => child.name === "content")?.required).toBe(false);
    expect(element.children.find((child) => child.name === "oldStr")?.required).toBe(false);
    expect(element.children.find((child) => child.name === "source")?.required).toBe(false);
    expect(projection.tsHintLines).toEqual(
      expect.arrayContaining([
        "  operations: [",
        "    {",
        '      kind: "add" | "update" | "write" | "delete" | "move"',
        "      path?: string",
        "      content?: string",
      ]),
    );
    expect(projection.xmlPreview).toContain("<operations>");
    expect(projection.xmlPreview).toContain("<kind>");
  });

  test("expands a discriminated union in a nested object property", () => {
    const input = z.object({
      file: z.object({
        action: z.union([
          z.object({ op: z.literal("create"), content: z.string() }).strict(),
          z.object({ op: z.literal("remove") }).strict(),
        ]),
      }),
    });
    const schema = ensureObjectRootJsonSchema(z.toJSONSchema(input, { target: "draft-7", io: "input" }));

    const projection = new AgentJsonSchemaPromptContractProjector().project(schema);

    const file = projection.properties.find((property) => property.name === "file");
    const action = file?.children.find((child) => child.name === "action");
    expect(action?.kind).toBe("object");
    expect(action?.children.map((child) => child.name)).toEqual(["op", "content"]);
    expect(action?.children.find((child) => child.name === "op")?.typeText).toBe('"create" | "remove"');
    expect(action?.children.find((child) => child.name === "op")?.required).toBe(true);
    expect(action?.children.find((child) => child.name === "content")?.required).toBe(false);
  });

  test("keeps a mixed union as a scalar type text", () => {
    const input = z.object({
      value: z.union([z.string(), z.number()]),
    });
    const schema = ensureObjectRootJsonSchema(z.toJSONSchema(input, { target: "draft-7", io: "input" }));

    const projection = new AgentJsonSchemaPromptContractProjector().project(schema);

    const value = projection.properties.find((property) => property.name === "value");
    expect(value?.kind).toBe("scalar");
    expect(value?.typeText).toBe("string | number");
  });
});
