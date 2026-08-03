import { describe, expect, test } from "vitest";
import {
  AgentCompactionSummaryTags,
  compactionSummaryOpen,
  compactionSummaryClose,
} from "../../../Source/AgentSystem/Pi/AgentPiCompactionTags.js";

describe("AgentPiCompactionTags", () => {
  describe("AgentCompactionSummaryTags", () => {
    test("summary tag is compaction_summary", () => {
      expect(AgentCompactionSummaryTags.summary).toBe("compaction_summary");
    });

    test("toolIndex tag is compaction_tool_index", () => {
      expect(AgentCompactionSummaryTags.toolIndex).toBe("compaction_tool_index");
    });

    test("has exactly two keys: summary and toolIndex", () => {
      expect(Object.keys(AgentCompactionSummaryTags).sort()).toEqual(["summary", "toolIndex"]);
    });
  });

  describe("compactionSummaryOpen / Close", () => {
    test("open tag wraps the summary tag name in angle brackets", () => {
      expect(compactionSummaryOpen).toBe(`<${AgentCompactionSummaryTags.summary}>`);
    });

    test("close tag wraps the summary tag name with slash", () => {
      expect(compactionSummaryClose).toBe(`</${AgentCompactionSummaryTags.summary}>`);
    });

    test("open and close are consistent with tag name", () => {
      expect(compactionSummaryOpen).toBe("<compaction_summary>");
      expect(compactionSummaryClose).toBe("</compaction_summary>");
    });
  });

  describe("cross-consistency", () => {
    test("summary and toolIndex tags are distinct", () => {
      expect(AgentCompactionSummaryTags.summary).not.toBe(AgentCompactionSummaryTags.toolIndex);
    });

    test("open and close tags are distinct strings", () => {
      expect(compactionSummaryOpen).not.toBe(compactionSummaryClose);
    });
  });
});
