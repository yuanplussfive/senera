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

  it("fans out consecutive root tool calls and converges into the next root step", () => {
    const steps = [
      {
        id: "decision",
        kind: "decision",
        title: "Choose tools",
        status: "done",
        startedAt: "2026-06-09T00:00:00.000Z",
      },
      {
        id: "tool-a",
        kind: "tool",
        title: "Call A",
        status: "done",
        startedAt: "2026-06-09T00:00:01.000Z",
        callId: "a",
        toolBatch: { id: "request:1", index: 0, size: 2 },
      },
      {
        id: "tool-b",
        kind: "tool",
        title: "Call B",
        status: "done",
        startedAt: "2026-06-09T00:00:01.000Z",
        callId: "b",
        toolBatch: { id: "request:1", index: 1, size: 2 },
      },
      {
        id: "answer",
        kind: "answer",
        title: "Answer",
        status: "done",
        startedAt: "2026-06-09T00:00:02.000Z",
      },
    ] satisfies TimelineStep[];

    const { edges } = layoutSteps(steps);

    expect(edgePairs(edges)).toEqual(expect.arrayContaining([
      "decision->tool-a",
      "decision->tool-b",
      "tool-a->answer",
      "tool-b->answer",
    ]));
    expect(edgePairs(edges)).not.toContain("tool-a->tool-b");
  });

  it("keeps adjacent tool calls sequential when no execution batch is declared", () => {
    const steps = [
      {
        id: "decision",
        kind: "decision",
        title: "Choose tools",
        status: "done",
        startedAt: "2026-06-09T00:00:00.000Z",
      },
      {
        id: "tool-a",
        kind: "tool",
        title: "Call A",
        status: "done",
        startedAt: "2026-06-09T00:00:01.000Z",
        callId: "a",
      },
      {
        id: "tool-b",
        kind: "tool",
        title: "Call B",
        status: "done",
        startedAt: "2026-06-09T00:00:02.000Z",
        callId: "b",
      },
    ] satisfies TimelineStep[];

    const { edges } = layoutSteps(steps);

    expect(edgePairs(edges)).toEqual(expect.arrayContaining([
      "decision->tool-a",
      "tool-a->tool-b",
    ]));
  });

  it("groups child-agent steps in parallel and converges through merge", () => {
    const steps = [
      {
        id: "delegate-tool",
        kind: "tool",
        title: "Delegate",
        status: "done",
        startedAt: "2026-06-09T00:00:00.000Z",
        callId: "delegate",
      },
      scopedStep("child-a-model", "ReviewerA", "job-a", "childAgent"),
      scopedStep("child-b-model", "ReviewerB", "job-b", "childAgent"),
      scopedStep("merge-model", undefined, undefined, "merge"),
      {
        id: "answer",
        kind: "answer",
        title: "Answer",
        status: "done",
        startedAt: "2026-06-09T00:00:03.000Z",
      },
    ] satisfies TimelineStep[];

    const { nodes, edges } = layoutSteps(steps);
    const pairs = edgePairs(edges);

    expect(nodes.some((node) => node.id.includes("ReviewerA") && node.data.kind === "scope")).toBe(true);
    expect(nodes.some((node) => node.id.includes("ReviewerB") && node.data.kind === "scope")).toBe(true);
    expect(nodes.some((node) => node.id.includes("merge") && node.data.kind === "scope")).toBe(true);
    expect(pairs.some((pair) => pair.startsWith("delegate-tool->scope:ReviewWorkflow:childAgent:job-a"))).toBe(true);
    expect(pairs.some((pair) => pair.startsWith("delegate-tool->scope:ReviewWorkflow:childAgent:job-b"))).toBe(true);
    expect(pairs.some((pair) => pair.endsWith("->scope:ReviewWorkflow:merge"))).toBe(true);
    expect(pairs).toContain("merge-model->answer");
  });
});

function edgePairs(edges: ReturnType<typeof layoutSteps>["edges"]): string[] {
  return edges.map((edge) => `${edge.source}->${edge.target}`);
}

function scopedStep(
  id: string,
  agentName: string | undefined,
  jobId: string | undefined,
  role: NonNullable<TimelineStep["scope"]>["role"],
): TimelineStep {
  return {
    id,
    kind: "model",
    title: "Model",
    status: "done",
    startedAt: "2026-06-09T00:00:01.000Z",
    scope: {
      parentRequestId: "parent",
      workflowName: "ReviewWorkflow",
      agentName,
      jobId,
      role,
    },
  };
}
