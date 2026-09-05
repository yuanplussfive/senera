import { describe, expect, test } from "vitest";
import type {
  AgentMemoryRecordedTurn,
  AgentMemorySourceRecord,
} from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import type { AgentTurnValueClassification } from "../../../Source/AgentSystem/Continuity/AgentTurnValueClassifier.js";
import { decideAgentContinuityLearning } from "../../../Source/AgentSystem/Continuity/AgentContinuityLearningGate.js";

describe("continuity learning gate", () => {
  const config = {
    enabled: true,
    deferredDelayMs: 30_000,
    turnValueClassifierEnabled: true,
  };

  test("skips only a high-confidence learned unproductive turn", () => {
    expect(decideAgentContinuityLearning(turn("好的。"), config, classification("unproductive"))).toEqual({
      mode: "skip",
      reason: "unproductive_classified",
    });
  });

  test("learns a short but evidence-backed turn", () => {
    expect(
      decideAgentContinuityLearning(turn("好", ["tool_evidence"]), config, classification("unproductive")),
    ).toEqual({
      mode: "immediate",
      reason: "runtime_evidence",
    });
  });

  test("does not skip a trivial phrase when the turn has runtime evidence", () => {
    expect(
      decideAgentContinuityLearning(turn("好的", ["tool_evidence"]), config, classification("unproductive")),
    ).toEqual({
      mode: "immediate",
      reason: "runtime_evidence",
    });
  });

  test("defers ordinary user input without using a character threshold", () => {
    expect(decideAgentContinuityLearning(turn("我住在上海"), config, classification("unknown"))).toEqual({
      mode: "deferred",
      reason: "ordinary_turn",
      deferredUntilMs: 30_001,
    });
  });

  test("immediately learns an explicit MemoryWriteTool evidence record", () => {
    expect(
      decideAgentContinuityLearning(turn("记住这个", ["tool_evidence"], true), config, classification("unproductive")),
    ).toEqual({
      mode: "immediate",
      reason: "explicit_memory",
    });
  });

  test("learns every turn immediately when the gate is disabled", () => {
    expect(
      decideAgentContinuityLearning(turn("好"), { ...config, enabled: false }, classification("unproductive")),
    ).toEqual({
      mode: "immediate",
      reason: "disabled",
    });
  });
});

function classification(label: AgentTurnValueClassification["label"]): AgentTurnValueClassification {
  return {
    label,
    confidence: label === "unknown" ? 0 : 0.95,
    trainedExamples: { valuable: 3, unproductive: 3 },
  };
}

function turn(
  rawUserText: string,
  sourceKinds: AgentMemorySourceRecord["sourceKind"][] = [],
  explicitMemory = false,
): AgentMemoryRecordedTurn {
  return {
    episode: {
      id: "episode-1",
      uri: "senera://memory-episode/episode-1",
      sessionId: "session-1",
      requestId: "request-1",
      status: "completed",
      rawUserText,
      standaloneRequest: rawUserText,
      contextMode: "session",
      contextBasis: "current",
      topic: "test",
      assistantPreview: rawUserText,
      startedAt: "2026-08-23T00:00:00+08:00",
      completedAt: "2026-08-23T00:00:01+08:00",
      updatedAt: "2026-08-23T00:00:01+08:00",
      startedAtMs: 0,
      completedAtMs: 1,
      updatedAtMs: 1,
      timeZone: "Asia/Shanghai",
      localDate: "2026-08-23",
      localHour: "08",
      metadata: explicitMemory ? { evidence: { kind: "continuity_write" } } : {},
    },
    sources: sourceKinds.map((sourceKind, index) => ({
      id: `source-${index}`,
      uri: `senera://memory-source/source-${index}`,
      episodeId: "episode-1",
      episodeUri: "senera://memory-episode/episode-1",
      sessionId: "session-1",
      requestId: "request-1",
      sourceKind,
      role: "tool",
      textContent: null,
      summary: sourceKind,
      conversationEntryId: "entry-1",
      evidenceUri: "",
      artifactUri: "",
      toolName: "",
      createdAt: "2026-08-23T00:00:00+08:00",
      updatedAt: "2026-08-23T00:00:00+08:00",
      createdAtMs: 0,
      updatedAtMs: 0,
      timeZone: "Asia/Shanghai",
      localDate: "2026-08-23",
      localHour: "08",
      metadata: explicitMemory ? { evidence: { kind: "continuity_write" } } : {},
    })),
  };
}
