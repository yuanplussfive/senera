import { describe, expect, test } from "vitest";
import {
  formatSystemMessage,
  jsonSection,
  section,
} from "../../../Source/AgentSystem/ActionPlanner/AgentPlannerSystemMessageFormatter.js";

describe("AgentPlannerSystemMessageFormatter", () => {
  test("joins escaped text sections in caller order", () => {
    const result = formatSystemMessage([section("runtime_context", "a < b & c"), section("custom_section", "second")]);

    expect(result).toContain("a &lt; b &amp; c");
    expect(result.indexOf("runtime_context")).toBeLessThan(result.indexOf("custom_section"));
  });

  test("serializes JSON sections safely", () => {
    const result = formatSystemMessage([jsonSection("openai_request", { value: "</openai_request><evil>&]]>" })]);

    expect(result).not.toContain("</openai_request><evil>");
    expect(result).toContain("&lt;/openai_request&gt;&lt;evil&gt;&amp;]]&gt;");
  });

  test("omits empty text sections when requested", () => {
    const result = formatSystemMessage([section("runtime_context", "  "), section("routing_cards", "present")], {
      omitEmpty: true,
    });

    expect(result).toBe("<routing_cards>present</routing_cards>");
  });

  test("emits a self-closing element for an empty section by default", () => {
    expect(formatSystemMessage([section("runtime_context", "")])).toBe("<runtime_context/>");
  });

  test("supports arbitrary valid extension tags without a central descriptor map", () => {
    expect(formatSystemMessage([section("future_context", "value")])).toContain("<future_context>");
  });

  test("escapes attributes and rejects invalid dynamic tag names", () => {
    const result = formatSystemMessage([section("notice", "value", [["source", 'a" b']])]);
    expect(result).toContain('source="a&quot; b"');
    expect(() => formatSystemMessage([section("bad><tag", "value")])).toThrow(/Invalid prompt XML tag name/);
  });
});
