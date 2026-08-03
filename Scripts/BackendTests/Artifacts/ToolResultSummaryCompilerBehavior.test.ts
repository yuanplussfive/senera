import { describe, expect, test } from "vitest";
import { AgentToolResultSummaryCompiler } from "../../../Source/AgentSystem/Artifacts/AgentToolResultSummaryCompiler.js";

describe("Tool result summary compiler", () => {
  test("bounds template output before exact tokenization and records the limitation", () => {
    const source = "x".repeat(250_000);
    const summary = new AgentToolResultSummaryCompiler({
      model: "gpt-4o",
      policy: { summarySourceCharacters: 1_024 },
    }).compile({
      toolName: "LargeTool",
      callId: "call-large",
      status: "success",
      artifactUri: "senera://artifact/large",
      deterministicSummary: source,
      result: { text: source },
      evidence: [],
      delta: [],
    });

    expect(summary.summary.length).toBeLessThanOrEqual(1_024);
    expect(summary.summary).not.toBe(source);
    expect(summary.limitations).toContain(
      "Summary source exceeded its projection character limit; retrieve the artifact for the full result.",
    );
    expect(summary.retrieval.artifactUri).toBe("senera://artifact/large");
  });
});
