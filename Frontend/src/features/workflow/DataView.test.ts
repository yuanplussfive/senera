import { describe, expect, it } from "vitest";
import {
  combineUnitPairs,
  formatLineRange,
  humanizeAlgo,
  parseNumberedLine,
  readSourceFrame,
} from "./DataView";

describe("workflow DataView helpers", () => {
  it("humanizes object keys without dictionary mappings", () => {
    expect(humanizeAlgo("promptTokenCount")).toBe("prompt token count");
    expect(humanizeAlgo("tool_result_url")).toBe("tool result url");
    expect(humanizeAlgo("retry-code")).toBe("retry code");
    expect(humanizeAlgo("[3]")).toBe("[3]");
  });

  it("combines value and unit pairs while preserving standalone unit rows", () => {
    expect(
      combineUnitPairs([
        ["temperature", 25],
        ["temperatureUnit", "C"],
        ["latencyMs", 1234],
        ["latencyMsUnit", "ms"],
        ["orphanUnit", "kept"],
        ["status", "ok"],
      ]),
    ).toEqual([
      { key: "temperature", value: 25, unit: "C" },
      { key: "latencyMs", value: 1234, unit: "ms" },
      { key: "orphanUnit", value: "kept" },
      { key: "status", value: "ok" },
    ]);
  });

  it("reads source frame metadata and hides frame location fields", () => {
    const frame = readSourceFrame({
      filePath: "src/app.ts",
      startLine: 10,
      endLine: 12,
      line: 11,
      snippet: "10 | const a = 1;\n11 | const b = 2;",
      reason: "failure",
    });

    expect(frame).toEqual({
      path: "src/app.ts",
      startLine: 10,
      endLine: 12,
      focusLine: 11,
      code: "10 | const a = 1;\n11 | const b = 2;",
      metadata: [["reason", "failure"]],
    });
  });

  it("rejects plain content without source location", () => {
    expect(readSourceFrame({ content: "plain text\nwith newline" })).toBeNull();
  });

  it("parses numbered source lines and formats line ranges", () => {
    expect(parseNumberedLine("  42 | return value;")).toEqual({
      line: 42,
      code: "return value;",
    });
    expect(parseNumberedLine("not numbered")).toBeNull();
    expect(formatLineRange({ code: "x", metadata: [], startLine: 4, endLine: 4 })).toBe("L4");
    expect(formatLineRange({ code: "x", metadata: [], startLine: 4, endLine: 7 })).toBe("L4-L7");
    expect(formatLineRange({ code: "x", metadata: [], focusLine: 9 })).toBe("L9");
    expect(formatLineRange({ code: "x", metadata: [] })).toBe("source");
  });
});
