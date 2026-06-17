import { describe, expect, it } from "vitest";
import type { RunRecord } from "../../store/sessionStore";
import { shouldLoadWorkflowCanvas } from "./canvasLoadPolicy";

function buildRun(steps: RunRecord["steps"]): RunRecord {
  return {
    requestId: "req-1",
    revision: 0,
    startedAt: "2026-06-08T00:00:00.000Z",
    status: "running",
    input: "inspect workflow",
    streamingRaw: "",
    xmlPreview: "",
    visibleText: "",
    visibleKind: "unknown",
    expectedOutputMode: "unknown",
    decisionMode: "none",
    pendingToolArgsByName: {},
    steps,
  };
}

describe("shouldLoadWorkflowCanvas", () => {
  it("requires an existing run with at least one step", () => {
    expect(shouldLoadWorkflowCanvas(undefined)).toBe(false);
    expect(shouldLoadWorkflowCanvas(buildRun([]))).toBe(false);
    expect(
      shouldLoadWorkflowCanvas(
        buildRun([
          {
            id: "understand",
            kind: "understand",
            title: "理解请求",
            status: "done",
            startedAt: "2026-06-08T00:00:00.000Z",
          },
        ]),
      ),
    ).toBe(true);
  });
});
