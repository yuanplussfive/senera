import { describe, expect, test } from "vitest";
import { formatAjvIssue, formatZodIssue } from "../../../Source/AgentSystem/Diagnostics/AgentValidationIssue.js";

describe("validation issue formatting", () => {
  test("formats Zod root and nested paths", () => {
    expect(formatZodIssue({ path: [], message: "Invalid input" })).toBe("root: Invalid input");
    expect(formatZodIssue({ path: ["providers", 1, "model"], message: "Required" })).toBe(
      "providers.1.model: Required",
    );
  });

  test("formats Ajv root issues with the caller's label", () => {
    expect(
      formatAjvIssue({ instancePath: "", params: {}, message: "must be object" }, { rootLabel: "arguments" }),
    ).toBe("arguments: must be object");
  });

  test("decodes JSON Pointer paths and appends property parameters", () => {
    expect(
      formatAjvIssue(
        {
          instancePath: "/items/0/a~1b/~0name",
          params: { missingProperty: "value" },
          message: "must have required property 'value'",
        },
        { rootLabel: "arguments" },
      ),
    ).toBe("items.0.a/b.~name.value: must have required property 'value'");
  });

  test("preserves bracketed numeric segments for tool paths", () => {
    expect(
      formatAjvIssue(
        {
          instancePath: "/items/2",
          params: { additionalProperty: "unexpected" },
          message: undefined,
        },
        {
          rootPath: ["toolCalls", 1, "args"],
          rootLabel: "arguments",
          numericPathStyle: "brackets",
        },
      ),
    ).toBe("toolCalls.[1].args.items.[2].unexpected: JSON Schema validation failed");
  });
});
