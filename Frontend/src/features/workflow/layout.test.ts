import { describe, expect, it } from "vitest";
import type { TimelineStep } from "../../store/sessionStore";
import { layoutSteps } from "./layout";

describe("layoutSteps", () => {
  it("returns empty React Flow elements for an empty timeline", () => {
    expect(layoutSteps([])).toEqual({ nodes: [], edges: [] });
  });

  it("projects workflow steps into typed React Flow nodes and edges", () => {
    const steps = [
      {
        id: "decision",
        kind: "decision",
        title: "Choose tool",
        status: "done",
        startedAt: "2026-06-09T00:00:00.000Z",
      },
      {
        id: "tool-1",
        kind: "tool",
        title: "Call shell",
        status: "running",
        startedAt: "2026-06-09T00:00:01.000Z",
        callId: "call-1",
      },
      {
        id: "answer",
        kind: "answer",
        title: "Answer",
        status: "done",
        startedAt: "2026-06-09T00:00:02.000Z",
      },
    ] satisfies TimelineStep[];

    const { nodes, edges } = layoutSteps(steps);

    expect(nodes).toHaveLength(3);
    expect(nodes[0]).toMatchObject({
      id: "decision",
      type: "step",
      data: { step: steps[0] },
      draggable: true,
    });
    expect(nodes.every((node) => Number.isFinite(node.position.x) && Number.isFinite(node.position.y))).toBe(
      true,
    );

    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "decision->tool-1",
          source: "decision",
          target: "tool-1",
          animated: true,
          type: "smoothstep",
        }),
        expect.objectContaining({
          id: "tool-1->answer",
          source: "tool-1",
          target: "answer",
          animated: false,
          type: "smoothstep",
        }),
      ]),
    );
  });
});
