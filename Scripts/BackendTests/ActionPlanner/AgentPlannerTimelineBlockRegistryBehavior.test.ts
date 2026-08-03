import { z } from "zod";
import { describe, expect, test } from "vitest";
import { promptXmlNode, promptXmlText } from "../../../Source/AgentSystem/ActionPlanner/AgentPromptXml.js";
import {
  AgentPlannerTimelineProjectorRegistry,
  createAgentPlannerTimelineProjectorRegistry,
  defineAgentPlannerTimelineProjector,
  formatTimelineTurnContent,
  type TimelineTurnInput,
} from "../../../Source/AgentSystem/ActionPlanner/AgentPlannerTimelineBlockRegistry.js";

function baseTurn(overrides: Partial<TimelineTurnInput> = {}): TimelineTurnInput {
  return {
    index: undefined,
    role: "assistant",
    kind: "",
    step: null,
    content: "",
    payload: undefined,
    evidenceUris: undefined,
    artifactUris: undefined,
    ...overrides,
  };
}

describe("AgentPlannerTimelineBlockRegistry", () => {
  test.each([
    ["tool_preface", "preface"],
    ["final_answer", "answer"],
    ["ask_user", "ask"],
  ])("routes explicit %s kind to <%s>", (kind, tag) => {
    const result = formatTimelineTurnContent(baseTurn({ kind, content: "hello", step: 3 }));

    expect(result).toContain(`<timeline_turn role="assistant" kind="${kind}" step="3">`);
    expect(result).toContain(`<${tag}`);
    expect(result).toContain("hello");
  });

  test("marks final answers terminal", () => {
    const result = formatTimelineTurnContent(baseTurn({ kind: "final_answer", content: "done" }));

    expect(result).toContain('<answer terminal="true">');
  });

  test("projects all calls in input order for the explicit tool_call kind", () => {
    const result = formatTimelineTurnContent(
      baseTurn({
        kind: "tool_call",
        payload: {
          calls: [
            { callId: "c1", name: "search", arguments: { query: "first" } },
            { callId: "c2", name: "read", arguments: { path: "second" } },
          ],
        },
      }),
    );

    expect(result).toContain('<call index="0" name="search" id="c1">');
    expect(result).toContain('<call index="1" name="read" id="c2">');
    expect(result.indexOf('id="c1"')).toBeLessThan(result.indexOf('id="c2"'));
  });

  test("accepts the legacy single-call shape only under an explicit tool_call kind", () => {
    const result = formatTimelineTurnContent(
      baseTurn({
        kind: "tool_call",
        payload: { calls: { id: "single", name: "search", arguments: {} } },
      }),
    );

    expect(result).toContain('<call index="0" name="search" id="single">');
  });

  test("projects all observations in order with semantic attributes", () => {
    const result = formatTimelineTurnContent(
      baseTurn({
        role: "user",
        kind: "tool_observation",
        payload: {
          observations: [
            { callId: "c1", name: "search", response: { ok: true }, result: "first" },
            { callId: "c2", response: { ok: false }, result: "second" },
          ],
        },
      }),
    );

    expect(result).toContain('<result call_id="c1" name="search" status="success">');
    expect(result).toContain('<result call_id="c2" status="failed">');
    expect(result.indexOf('call_id="c1"')).toBeLessThan(result.indexOf('call_id="c2"'));
  });

  test("does not guess semantics from payload fields for an unknown kind", () => {
    const result = formatTimelineTurnContent(
      baseTurn({
        kind: "future_event",
        payload: {
          calls: [{ name: "search" }],
          observations: [{ callId: "c1" }],
          message: "keep me",
        },
      }),
    );

    expect(result).not.toContain("<call");
    expect(result).not.toContain("<result");
    expect(result).toContain('"calls"');
    expect(result).toContain('"observations"');
    expect(result).toContain('"message"');
  });

  test("preserves unconsumed fields as metadata instead of first-match loss", () => {
    const result = formatTimelineTurnContent(
      baseTurn({
        kind: "tool_call",
        payload: {
          calls: [{ name: "search", arguments: {} }],
          observations: [{ callId: "unexpected-but-preserved" }],
        },
      }),
    );

    expect(result).toContain("<call");
    expect(result).toContain("<payload_metadata>");
    expect(result).toContain("unexpected-but-preserved");
    expect(result).not.toContain("<result");
  });

  test("preserves content and payload together for unknown kinds", () => {
    const result = formatTimelineTurnContent(
      baseTurn({ kind: "custom", content: "visible text", payload: { value: 42 } }),
    );

    expect(result).toContain("<content>");
    expect(result).toContain("visible text");
    expect(result).toContain("<payload>");
    expect(result).toContain('"value":42');
  });

  test("projects every memory-learning producer kind explicitly", () => {
    for (const kind of ["memory_user_message", "memory_assistant_context", "memory_tool_evidence", "memory_artifact"]) {
      const result = formatTimelineTurnContent(baseTurn({ kind, payload: { sourceRef: `memory://${kind}` } }));
      expect(result).toContain(`<memory_source type="${kind}">`);
      expect(result).toContain(`memory://${kind}`);
    }
  });

  test("represents references as structured sibling elements", () => {
    const result = formatTimelineTurnContent(
      baseTurn({
        kind: "final_answer",
        content: "done",
        evidenceUris: ["file:///a.ts", "file:///b.ts"],
        artifactUris: ["artifact://result.json"],
      }),
    );

    expect(result.match(/<evidence_uri>/g)).toHaveLength(2);
    expect(result).toContain("<artifact_uri>");
  });

  test("escapes JSON and text that try to close semantic tags", () => {
    const result = formatTimelineTurnContent(
      baseTurn({
        kind: "tool_call",
        payload: {
          calls: [{ name: 'x" bad="1', arguments: { value: "</call><evil>&]]>" } }],
        },
      }),
    );

    expect(result).not.toContain("</call><evil>");
    expect(result).not.toContain('name="x" bad="1"');
    expect(result).toContain("&lt;/call&gt;&lt;evil&gt;&amp;]]&gt;");
    expect(result).toContain('name="x&quot; bad=&quot;1"');
  });

  test("rejects malformed payloads for known semantic kinds", () => {
    expect(() => formatTimelineTurnContent(baseTurn({ kind: "tool_call", payload: { calls: "bad" } }))).toThrow(
      /timeline payload for kind "tool_call"/,
    );
  });

  test("supports extension by adding a projector without changing central routing", () => {
    const registry = createAgentPlannerTimelineProjectorRegistry([
      defineAgentPlannerTimelineProjector({
        kinds: ["custom_notice"],
        payloadSchema: z.object({ notice: z.string() }),
        project: (_turn, payload) => [promptXmlNode("notice", promptXmlText(payload.notice))],
      }),
    ]);

    const result = formatTimelineTurnContent(
      baseTurn({ kind: "custom_notice", payload: { notice: "registered" } }),
      registry,
    );
    expect(result).toContain("<notice>");
    expect(result).toContain("registered");
  });

  test("rejects duplicate semantic kind registrations", () => {
    const projector = defineAgentPlannerTimelineProjector({
      kinds: ["duplicate"],
      payloadSchema: z.unknown(),
      project: () => [],
    });

    expect(() => new AgentPlannerTimelineProjectorRegistry([projector, projector])).toThrow(
      /Duplicate action planner timeline projector kind/,
    );
  });

  test("omits empty unknown turns", () => {
    expect(formatTimelineTurnContent(baseTurn())).toBe("");
  });
});
