import { describe, expect, test } from "vitest";
import { selectAgentContinuityLearningCatalogs } from "../../../Source/AgentSystem/Continuity/AgentContinuityLearningContextSelector.js";
import { AgentContinuityRecallRankingDefaults } from "../../../Source/AgentSystem/Continuity/AgentContinuityRecallDefaults.js";
import type { AgentMemoryRecordedTurn } from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import type { AgentAgendaRecord } from "../../../Source/AgentSystem/Agenda/AgentAgendaTypes.js";
import type { AgentResidentProfilePromptEntry } from "../../../Source/AgentSystem/Profile/AgentResidentProfileTypes.js";

describe("continuity learning catalog selection", () => {
  test("ranks profile and agenda catalogs from episode evidence without phrase rules", () => {
    const profiles: AgentResidentProfilePromptEntry[] = [profile("常用语言", "中文"), profile("居住地点", "上海")];
    const agendaRecords = [agenda("下周搬到杭州"), agenda("年底整理照片")];
    const selection = selectAgentContinuityLearningCatalogs({
      recordedTurn: recordedTurn("我已经不住在上海了，也不准备搬去杭州，取消那个搬家计划。"),
      referents: [],
      profiles,
      agendaRecords,
      budgetCharacters: 10_000,
      similarity: AgentContinuityRecallRankingDefaults.Similarity,
    });

    expect(selection.profiles.map(({ key }) => key)).toEqual(["居住地点", "常用语言"]);
    expect(selection.agendaRecords.map(({ summary }) => summary)).toEqual(["下周搬到杭州", "年底整理照片"]);
  });

  test("uses one shared character budget instead of fixed catalog counts", () => {
    const selection = selectAgentContinuityLearningCatalogs({
      recordedTurn: recordedTurn("我住在上海。"),
      referents: [],
      profiles: [profile("居住地点", "上海")],
      agendaRecords: [agenda("去上海旅行")],
      budgetCharacters: 1,
      similarity: AgentContinuityRecallRankingDefaults.Similarity,
    });

    expect(selection).toEqual({ profiles: [], agendaRecords: [] });
  });
});

function profile(key: string, value: string): AgentResidentProfilePromptEntry {
  return {
    subject: "user",
    key,
    valueJson: JSON.stringify(value),
    claim: `${key}: ${value}`,
    validUntil: "",
    sourceRefs: ["senera://memory-source/test"],
  };
}

function agenda(summary: string): AgentAgendaRecord {
  return {
    id: `agenda-${summary}`,
    revision: 1,
    uri: `senera://agenda/${summary}`,
    worldId: "world-test",
    actorId: "actor-user",
    actor: {
      id: "actor-user",
      uri: "senera://agenda-actor/user",
      worldId: "world-test",
      role: "user",
      createdAt: "2026-08-31T00:00:00.000Z",
    },
    kind: "goal",
    summary,
    status: "planned",
    dueAt: null,
    startsAt: null,
    endsAt: null,
    relatedRecordId: null,
    detail: null,
    sourceRefs: ["senera://memory-source/test"],
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    lastEventId: "event-test",
  };
}

function recordedTurn(text: string): AgentMemoryRecordedTurn {
  const timestamp = "2026-08-31T04:00:00.000Z";
  return {
    episode: {
      id: "episode-test",
      uri: "senera://memory-episode/test",
      sessionId: "session-test",
      requestId: "request-test",
      status: "completed",
      rawUserText: text,
      standaloneRequest: text,
      contextMode: "current",
      contextBasis: "current turn",
      topic: "test",
      assistantPreview: "",
      startedAt: timestamp,
      completedAt: timestamp,
      updatedAt: timestamp,
      startedAtMs: 1,
      completedAtMs: 1,
      updatedAtMs: 1,
      timeZone: "Asia/Shanghai",
      localDate: "2026-08-31",
      localHour: "12",
      metadata: {},
    },
    sources: [
      {
        id: "source-test",
        uri: "senera://memory-source/test",
        episodeId: "episode-test",
        episodeUri: "senera://memory-episode/test",
        sessionId: "session-test",
        requestId: "request-test",
        sourceKind: "user_message",
        role: "user",
        textContent: text,
        summary: null,
        conversationEntryId: "entry-test",
        evidenceUri: "",
        artifactUri: "",
        toolName: "",
        createdAt: timestamp,
        updatedAt: timestamp,
        createdAtMs: 1,
        updatedAtMs: 1,
        timeZone: "Asia/Shanghai",
        localDate: "2026-08-31",
        localHour: "12",
        metadata: {},
      },
    ],
  };
}
