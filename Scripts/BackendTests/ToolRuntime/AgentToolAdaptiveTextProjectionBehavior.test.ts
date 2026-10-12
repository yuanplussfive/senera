import { describe, expect, test } from "vitest";
import { AgentCancellationError } from "../../../Source/AgentSystem/Core/AgentCancellation.js";
import {
  AgentToolAdaptiveProjectionDefaults,
  AgentToolAdaptiveTextProjector,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolAdaptiveTextProjection.js";
import {
  createAgentToolTextSegmentation,
  extractAgentToolProtectedAtoms,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolTextSegmenter.js";
import { AgentModelTokenEstimator } from "../../../Source/AgentSystem/Text/AgentTextBudget.js";

describe("AgentToolAdaptiveTextProjector", () => {
  test("samples a bounded source while retaining protected facts from the tail", () => {
    const source = [
      ...Array.from({ length: 320 }, (_, index) => `diagnostic record ${index}: no additional evidence.`),
      "error: artifact=senera://artifact/tail-42 at Source/AgentSystem/ToolRuntime/AgentToolTextSegmenter.ts:42.",
    ].join("\n\n");
    const defaults = {
      ...AgentToolAdaptiveProjectionDefaults,
      minimumCharacters: 0,
      maximumUnits: 16,
      maximumSemanticUnits: 16,
    };
    const segmentation = createAgentToolTextSegmentation(
      source,
      new AgentModelTokenEstimator({ model: "gpt-4o" }),
      defaults.maximumUnits,
    );
    const projection = new AgentToolAdaptiveTextProjector("gpt-4o", defaults).project(source, {
      tokenLimit: 500,
      query: "find the artifact URI and source file",
    });

    expect(segmentation.sourceUnits).toBeGreaterThan(defaults.maximumUnits);
    expect(segmentation.omittedUnits).toBeGreaterThan(0);
    expect(segmentation.segments.some((segment) => segment.text.includes("senera://artifact/tail-42"))).toBe(true);
    expect(projection.text).toContain("senera://artifact/tail-42");
    expect(projection.text).toContain("AgentToolTextSegmenter.ts:42");
    expect(projection.sourceUnits).toBe(segmentation.sourceUnits);
    expect(projection.complete).toBe(false);
    expect(projection.omissionCount).toBeGreaterThan(0);
  });

  test("honors cancellation before optional semantic work starts", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      new AgentToolAdaptiveTextProjector("gpt-4o").project("long result", {
        tokenLimit: 16,
        signal: controller.signal,
      }),
    ).toThrow(AgentCancellationError);
  });

  test("extracts protected atoms without changing the source text", () => {
    const source = "artifact=senera://artifact/demo, revision=rev-7, status=error";
    expect(extractAgentToolProtectedAtoms(source)).toEqual(
      expect.arrayContaining(["senera://artifact/demo", "revision=rev-7", "status=error"]),
    );
  });
});
