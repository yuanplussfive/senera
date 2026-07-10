import { describe, expect, test } from "vitest";
import {
  exactRefMemoryRanking,
  fuseMemoryRankings,
  keywordMemoryRanking,
  scopedMemoryItems,
} from "../../../Source/AgentSystem/Memory/AgentMemoryRecallRanker.js";
import {
  memoryCandidateEmbeddingText,
  memoryItemRecallText,
} from "../../../Source/AgentSystem/Memory/AgentMemoryText.js";
import type {
  AgentMemoryCandidateDraft,
  AgentMemoryItemRecord,
  AgentMemorySourceRecord,
} from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";

describe("Memory recall behavior", () => {
  test("filters memory items by recall scope while preserving all scope order", () => {
    const items = [
      createMemoryItem("mem://preference", { type: "preference" }),
      createMemoryItem("mem://knowledge", { type: "knowledge" }),
    ];

    expect(scopedMemoryItems(items, "all").map((item) => item.uri)).toEqual([
      "mem://preference",
      "mem://knowledge",
    ]);
    expect(scopedMemoryItems(items, "preference").map((item) => item.uri)).toEqual([
      "mem://preference",
    ]);
  });

  test("ranks direct and source-ref memory hits as exact matches", () => {
    const direct = createMemoryItem("mem://direct");
    const sourced = createMemoryItem("mem://sourced", { sourceRefs: ["source://weather"] });
    const unrelated = createMemoryItem("mem://other");
    const source = createMemorySource("source://weather");

    expect(exactRefMemoryRanking({
      refs: [],
      sources: [source],
      items: [direct, sourced, unrelated],
      directItems: [direct],
    })).toEqual([
      { memoryUri: "mem://direct", score: 1 },
      { memoryUri: "mem://sourced", score: 1 },
    ]);
  });

  test("combines exact, keyword, and semantic rankings with exact references first and stable ties", () => {
    const fused = fuseMemoryRankings([
      {
        name: "keyword",
        entries: [
          { memoryUri: "mem://b", score: 10 },
          { memoryUri: "mem://a", score: 9 },
          { memoryUri: "mem://b", score: 8 },
        ],
      },
      {
        name: "exact_ref",
        entries: [
          { memoryUri: "mem://c", score: 1 },
        ],
      },
      {
        name: "semantic",
        entries: [
          { memoryUri: "mem://a", score: 0.7 },
          { memoryUri: "mem://b", score: 0.7 },
        ],
      },
    ], 10);

    expect(fused.map((entry) => entry.memoryUri)).toEqual([
      "mem://c",
      "mem://a",
      "mem://b",
    ]);
    expect(fused.find((entry) => entry.memoryUri === "mem://b")?.matchedBy).toEqual([
      "keyword",
      "semantic",
    ]);
  });

  test("keyword recall searches subject, claim, tags, and triggers", () => {
    const results = keywordMemoryRanking("deploy linux", [
      createMemoryItem("mem://deploy", {
        subject: "deployment",
        claim: "Use Linux compatible commands",
        tags: ["ops"],
        triggers: ["deploy"],
      }),
      createMemoryItem("mem://design", {
        subject: "design",
        claim: "Prefer compact layouts",
      }),
    ]);

    expect(results[0]?.memoryUri).toBe("mem://deploy");
  });

  test("memory text projection keeps embedding and recall text focused on durable facts", () => {
    const item = createMemoryItem("mem://theme", {
      subject: "frontend theme",
      claim: "Avoid one-note purple palettes",
      howToApply: "Use restrained mixed colors",
      tags: ["ui"],
      triggers: ["design"],
    });
    const candidate = createCandidate({
      subject: item.subject,
      claim: item.claim,
      howToApply: item.howToApply,
    });

    expect(memoryCandidateEmbeddingText(candidate)).toContain("preference");
    expect(memoryItemRecallText(item)).not.toContain("preference");
    expect(memoryItemRecallText(item)).toContain("Avoid one-note purple palettes");
  });
});

function createMemoryItem(
  uri: string,
  overrides: Partial<AgentMemoryItemRecord> = {},
): AgentMemoryItemRecord {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: uri.replace(/\W/g, "_"),
    uri,
    type: "preference",
    subject: "project",
    claim: "Prefer concise answers",
    howToApply: "Keep responses direct",
    tags: [],
    triggers: [],
    sourceRefs: [],
    status: "active",
    confidence: 0.8,
    sessionId: "session-1",
    sourceEpisodeUri: "episode://1",
    sourceRequestId: "request-1",
    createdAt: now,
    updatedAt: now,
    createdAtMs: 1,
    updatedAtMs: 1,
    timeZone: "Asia/Shanghai",
    localDate: "2026-01-01",
    localHour: "00",
    metadata: {},
    ...overrides,
  };
}

function createMemorySource(uri: string): AgentMemorySourceRecord {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: "source-1",
    uri,
    episodeId: "episode-1",
    episodeUri: "episode://1",
    sessionId: "session-1",
    requestId: "request-1",
    sourceKind: "tool_evidence",
    role: "tool",
    textContent: "weather result",
    summary: "weather result",
    conversationEntryId: "entry-1",
    evidenceUri: uri,
    artifactUri: "",
    toolName: "WeatherTool",
    createdAt: now,
    updatedAt: now,
    createdAtMs: 1,
    updatedAtMs: 1,
    timeZone: "Asia/Shanghai",
    localDate: "2026-01-01",
    localHour: "00",
    metadata: {},
  };
}

function createCandidate(overrides: Partial<AgentMemoryCandidateDraft>): AgentMemoryCandidateDraft {
  return {
    type: "preference",
    subject: "project",
    claim: "Prefer concise answers",
    howToApply: "Keep responses direct",
    tags: [],
    triggers: [],
    sourceRefs: [],
    reason: "stable user preference",
    confidence: 0.8,
    ...overrides,
  };
}
