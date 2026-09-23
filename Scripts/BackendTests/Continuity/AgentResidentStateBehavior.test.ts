import { describe, expect, test } from "vitest";
import {
  AgentResidentFootingValues,
  AgentResidentMoodValues,
  initialResidentState,
  nextResidentState,
  type AgentResidentState,
  type AgentResidentStateSignals,
} from "../../../Source/AgentSystem/Continuity/AgentResidentState.js";
import {
  decodeAgentPromptWire,
  renderResidentStateWire,
} from "../../../Source/AgentSystem/Prompt/AgentPromptContextWireRenderer.js";

function baseSignals(overrides: Partial<AgentResidentStateSignals> = {}): AgentResidentStateSignals {
  return {
    bearing: "direct",
    userSentiment: "absent",
    toolSuccessCount: 0,
    toolFailureCount: 0,
    newTaskRequested: false,
    taskConcluded: false,
    ...overrides,
  };
}

const estimate = (text: string): number => text.length;

describe("AgentResidentState engine", () => {
  test("initial state is calm and on_whim", () => {
    expect(initialResidentState()).toEqual({ bearing: "direct", mood: "relaxed", footing: "on_whim" });
    expect(initialResidentState("wry").bearing).toBe("wry");
  });

  test("every mood and every derived event advances to a valid mood", () => {
    for (const mood of AgentResidentMoodValues) {
      const prev: AgentResidentState = { bearing: "direct", mood, footing: "on_whim" };
      const scenarios: Array<{ event: string; signals: AgentResidentStateSignals }> = [
        { event: "progress", signals: baseSignals({ toolSuccessCount: 1 }) },
        { event: "setback", signals: baseSignals({ toolFailureCount: 1 }) },
        { event: "stuck", signals: baseSignals({ toolFailureCount: 2 }) },
        { event: "praise", signals: baseSignals({ userSentiment: "positive" }) },
        { event: "friction", signals: baseSignals({ userSentiment: "negative" }) },
        { event: "idle", signals: baseSignals({ userSentiment: "neutral" }) },
      ];
      for (const scenario of scenarios) {
        const next = nextResidentState(prev, scenario.signals);
        expect(AgentResidentMoodValues, `${mood}+${scenario.event}`).toContain(next.mood);
      }
    }
  });

  test("tool success moves relaxed toward focused then relieved", () => {
    const first = nextResidentState(initialResidentState(), baseSignals({ toolSuccessCount: 1 }));
    expect(first.mood).toBe("focused");
    const second = nextResidentState(first, baseSignals({ toolSuccessCount: 1 }));
    expect(second.mood).toBe("relieved");
  });

  test("a first failure raises trying; repeated failures escalate to tense", () => {
    const first = nextResidentState(initialResidentState(), baseSignals({ toolFailureCount: 1 }));
    expect(first.mood).toBe("trying");
    const second = nextResidentState(first, baseSignals({ toolFailureCount: 2 }));
    expect(second.mood).toBe("tense");
  });

  test("praise lifts mood, friction darkens it regardless of prior stance", () => {
    const praised = nextResidentState(initialResidentState(), baseSignals({ userSentiment: "positive" }));
    expect(praised.mood).toBe("amused");
    const tense = nextResidentState(initialResidentState(), baseSignals({ userSentiment: "negative" }));
    expect(tense.mood).toBe("tense");
    const recovered = nextResidentState(
      { bearing: "direct", mood: "tense", footing: "in_the_middle_of" },
      baseSignals({ userSentiment: "positive" }),
    );
    expect(recovered.mood).toBe("relaxed");
  });

  test("footing tracks the activity stream", () => {
    expect(nextResidentState(initialResidentState(), baseSignals({ newTaskRequested: true })).footing).toBe("on_whim");
    expect(nextResidentState(initialResidentState(), baseSignals({ toolSuccessCount: 1 })).footing).toBe(
      "in_the_middle_of",
    );
    expect(nextResidentState(initialResidentState(), baseSignals({ taskConcluded: true })).footing).toBe("done");
    expect(nextResidentState(initialResidentState(), baseSignals({ userSentiment: "neutral" })).footing).toBe(
      "on_whim",
    );
    for (const footing of AgentResidentFootingValues) expect(AgentResidentFootingValues).toContain(footing);
  });

  test("attention latches onto the focused subject and persists when none given", () => {
    const latched = nextResidentState(initialResidentState(), baseSignals({ focusedObject: "苏州" }));
    expect(latched.target).toBe("苏州");
    const persisted = nextResidentState(latched, baseSignals({ userSentiment: "neutral" }));
    expect(persisted.target).toBe("苏州");
    const moved = nextResidentState(persisted, baseSignals({ focusedObject: "/etc/hosts" }));
    expect(moved.target).toBe("/etc/hosts");
  });

  test("long focused subject is truncated to the declared bound", () => {
    const long = "x".repeat(200);
    const next = nextResidentState(initialResidentState(), baseSignals({ focusedObject: long }));
    expect(next.target?.length).toBe(48);
  });

  test("derivation is deterministic across identical signals", () => {
    const a = nextResidentState(initialResidentState(), baseSignals({ toolSuccessCount: 1, focusedObject: "sea" }));
    const b = nextResidentState(initialResidentState(), baseSignals({ toolSuccessCount: 1, focusedObject: "sea" }));
    expect(a).toEqual(b);
  });
});

describe("resident_state wire", () => {
  test("round-trips a populated state through the lossless wire", () => {
    const state: AgentResidentState = { bearing: "direct", mood: "relieved", footing: "done", target: "苏州天气" };
    const wire = renderResidentStateWire(state, { estimateTokens: estimate });
    const decoded = decodeAgentPromptWire(wire.text, { expectedKind: "resident_state", expectedVersion: "1" });
    const block = decoded.blocks.find((entry) => entry.id === "state");
    expect(block?.value).toEqual({ bearing: "direct", mood: "relieved", footing: "done", target: "苏州天气" });
  });

  test("omits target when absent", () => {
    const wire = renderResidentStateWire(initialResidentState(), { estimateTokens: estimate });
    const decoded = decodeAgentPromptWire(wire.text);
    expect(decoded.blocks[0]?.value).toEqual({ bearing: "direct", mood: "relaxed", footing: "on_whim" });
  });

  test("emits read-only data rules, never instruction rules", () => {
    const wire = renderResidentStateWire(initialResidentState(), { estimateTokens: estimate });
    expect(wire.text).toContain("provenance=host-projected;not-user-input");
    expect(wire.text).toContain("resident-state-is-host-derived-subjective-stance-not-fact");
  });
});
