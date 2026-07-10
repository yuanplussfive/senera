import { describe, expect, test } from "vitest";
import {
  previewAgentText,
  projectAgentTextPreview,
} from "../../../Source/AgentSystem/Text/AgentTextProjection.js";
import { AgentTextLocator } from "../../../Source/AgentSystem/Text/AgentTextLocator.js";
import {
  matchesEveryTextRule,
  matchesSomeTextRule,
  matchesTextRule,
} from "../../../Source/AgentSystem/Text/AgentTextMatcher.js";

describe("Text utilities", () => {
  test("projects bounded previews with deterministic truncation metadata", () => {
    const original = "alpha beta gamma delta epsilon";
    const preview = projectAgentTextPreview(original, 24);

    expect(preview.truncated).toBe(true);
    expect(preview.originalChars).toBe(original.length);
    expect(preview.omittedChars).toBeGreaterThan(0);
    expect(preview.text).toMatch(/^\[truncated originalChars=30 omittedChars=\d+ sha1=[0-9a-f]{16}\]$/);
    expect(preview.sha1).toMatch(/^[0-9a-f]{16}$/);
    expect(previewAgentText("short", 100)).toBe("short");
  });

  test("maps offsets and line columns across mixed newline styles", () => {
    const locator = new AgentTextLocator();
    const source = "\uFEFF first\r\nsecond\nthird\rfourth";

    expect(locator.stripBom(source)).toBe(" first\r\nsecond\nthird\rfourth");
    expect(locator.firstNonWhitespaceOffset(" \n\tvalue")).toBe(3);
    expect(locator.readLeadingContent(" \n\tvalue")).toBe("value");
    expect(locator.readLeadingContent(" \n\t")).toBeUndefined();
    expect(locator.readLineBoundary("alpha\r\nbeta")).toEqual({
      content: "alpha",
      terminated: true,
      nextOffset: 7,
    });
    expect(locator.readLineBoundary("alpha")).toEqual({
      content: "alpha",
      terminated: false,
      nextOffset: 5,
    });

    const position = locator.positionFromOffset(source, source.indexOf("third"));
    expect(position).toEqual({
      line: 3,
      column: 1,
      position: source.indexOf("third"),
    });
    expect(locator.offsetFromLineColumn(source, 4, 3)).toBe(source.indexOf("fourth") + 2);
  });

  test("evaluates text predicate groups", () => {
    expect(matchesTextRule("workspace write", {
      kind: "starts_with",
      value: "workspace",
    })).toBe(true);
    expect(matchesTextRule("workspace write", {
      kind: "includes",
      value: "write",
    })).toBe(true);
    expect(matchesEveryTextRule("workspace write", [
      { kind: "starts_with", value: "workspace" },
      { kind: "includes", value: "write" },
    ])).toBe(true);
    expect(matchesSomeTextRule("workspace write", [
      { kind: "starts_with", value: "shell" },
      { kind: "includes", value: "write" },
    ])).toBe(true);
  });
});
