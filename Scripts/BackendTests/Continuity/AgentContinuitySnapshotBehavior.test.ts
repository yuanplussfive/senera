import { describe, expect, test } from "vitest";
import { projectAgentContinuitySnapshot } from "../../../Source/AgentSystem/Continuity/AgentContinuitySnapshot.js";
import { AgentLoopPromptEventFactory } from "../../../Source/AgentSystem/Loop/AgentLoopPromptEventFactory.js";
import {
  AgentEventChannels,
  AgentEventKinds,
  AgentEventLayers,
  AgentEventPhases,
} from "../../../Source/AgentSystem/Events/AgentEventCatalog.js";
import { projectAgentRunEventForHistory } from "../../../Source/AgentSystem/Events/AgentRunEventHistoryPolicy.js";

describe("continuity snapshots", () => {
  const roleplayPreset = {
    enabled: true,
    activePresetName: "ciello.json",
    card: {
      title: "Ciello",
      corePersona: "一位直接的电子插画师。",
      languageStyle: "自然、简洁。",
      examples: [],
      lore: [],
    },
  };
  const continuityMemory = {
    enabled: true,
    concepts: [],
    graph: { scope: [], entities: [], relations: [] },
    graphRelations: [],
    temporalMemory: { counts: [], segmentDecisions: [], latestSealed: [] },
    residentProfile: [],
    pendingRuleDeliveryUris: ["senera://continuity-rule/internal-delivery"],
    factCatalog: [
      {
        factKey: "user.response_style",
        claim: "用户偏好先给结论。",
        sourceRefs: ["senera://memory-source/preference"],
        confidence: 0.95,
        authority: "user_explicit" as const,
        validFrom: "2026-08-20T08:00:00.000Z",
        supportCount: 2,
        supportMass: 0.99,
        maturity: "established" as const,
        updatedAt: "2026-08-22T08:00:00.000Z",
        score: 0.92,
        matchedBy: ["lexical"],
      },
    ],
    selection: {
      profiles: { available: 0, matched: 0, selected: 0 },
      facts: { available: 1, matched: 1, selected: 1 },
      relations: { available: 0, matched: 0, selected: 0 },
      events: { available: 0, matched: 0, selected: 0 },
      evidence: { available: 1, matched: 1, selected: 1 },
      usedCharacters: 120,
      maxCharacters: 24_000,
    },
    rejections: { belowSimilarity: 2, belowCandidate: 1, funnelSkipped: 0 },
    nearMisses: [
      {
        summary: "用户喜欢低饱和绿色界面。",
        score: 0.21,
        textSimilarityScore: 0.18,
        lexicalScore: 0.1,
        semanticScore: 0,
        matchedBy: ["lexical"],
      },
    ],
    evidenceCandidates: [
      {
        sourceRefs: ["senera://memory-source/candidate"],
        score: 0.48,
        matchedBy: ["lexical"],
      },
    ],
    eventCandidates: [],
    activeRules: [],
    ruleCatalog: [],
    signals: [],
  };

  test("projects selected learning records without internal record identifiers", () => {
    expect(projectAgentContinuitySnapshot(roleplayPreset, continuityMemory)).toEqual({
      enabled: true,
      concepts: [],
      graph: { scope: [], entities: [], relations: [] },
      graphRelations: [],
      temporalMemory: { counts: [], segmentDecisions: [], latestSealed: [] },
      residentProfile: [],
      preset: {
        enabled: true,
        activePresetName: "ciello.json",
        title: "Ciello",
        corePersona: "一位直接的电子插画师。",
        languageStyle: "自然、简洁。",
      },
      factCatalog: [
        {
          factKey: "user.response_style",
          claim: "用户偏好先给结论。",
          sourceRefs: ["senera://memory-source/preference"],
          confidence: 0.95,
          authority: "user_explicit",
          validFrom: "2026-08-20T08:00:00.000Z",
          supportCount: 2,
          supportMass: 0.99,
          maturity: "established" as const,
          updatedAt: "2026-08-22T08:00:00.000Z",
          score: 0.92,
          matchedBy: ["lexical"],
        },
      ],
      selection: continuityMemory.selection,
      rejections: { belowSimilarity: 2, belowCandidate: 1, funnelSkipped: 0 },
      nearMisses: [
        {
          summary: "用户喜欢低饱和绿色界面。",
          score: 0.21,
          textSimilarityScore: 0.18,
          lexicalScore: 0.1,
          semanticScore: 0,
          matchedBy: ["lexical"],
        },
      ],
      evidenceCandidates: [
        {
          sourceRefs: ["senera://memory-source/candidate"],
          score: 0.48,
          matchedBy: ["lexical"],
        },
      ],
      eventCandidates: [],
      rules: [],
      signals: [],
    });
    expect(JSON.stringify(projectAgentContinuitySnapshot(roleplayPreset, continuityMemory))).not.toContain(
      "internal-delivery",
    );
  });

  test("emits the snapshot with prompt events and preserves it for history replay", () => {
    const events = new AgentLoopPromptEventFactory().promptRendered(
      "request-1",
      1,
      "prompt",
      2,
      roleplayPreset,
      continuityMemory,
    );

    expect(events.map((event) => event.kind)).toEqual([
      AgentEventKinds.PromptSummary,
      AgentEventKinds.ContinuitySnapshot,
    ]);
    expect(events[1]).toMatchObject({
      context: { requestId: "request-1", step: 1 },
      data: { factCatalog: [{ claim: "用户偏好先给结论。" }] },
    });

    expect(
      projectAgentRunEventForHistory({
        eventId: "continuity-1",
        channel: AgentEventChannels.AgentEvent,
        kind: AgentEventKinds.ContinuitySnapshot,
        layer: AgentEventLayers.Snapshot,
        phase: AgentEventPhases.Prompt,
        sequence: 2,
        timestamp: "2026-08-22T08:00:00.000Z",
        sessionId: "session-1",
        requestId: "request-1",
        step: 1,
        data: projectAgentContinuitySnapshot(roleplayPreset, continuityMemory),
      }),
    ).toMatchObject({
      kind: AgentEventKinds.ContinuitySnapshot,
      sessionId: "session-1",
      requestId: "request-1",
      data: { preset: { title: "Ciello" }, evidenceCandidates: [{ score: 0.48 }] },
    });
  });
});
