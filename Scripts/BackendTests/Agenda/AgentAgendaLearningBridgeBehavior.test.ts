import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type {
  AgentMemoryRecordedTurn,
  AgentMemorySourceRecord,
} from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import { AgentAgendaLearningBridge } from "../../../Source/AgentSystem/Agenda/AgentAgendaLearningBridge.js";
import { AgentAgendaService } from "../../../Source/AgentSystem/Agenda/AgentAgendaService.js";
import { AgentAgendaSqliteStore } from "../../../Source/AgentSystem/Agenda/AgentAgendaSqliteStore.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { AgentContinuityRecallRankingDefaults } from "../../../Source/AgentSystem/Continuity/AgentContinuityRecallDefaults.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const TimeZone = "Asia/Shanghai";
const CompletedAt = "2026-08-29T01:30:00.000Z";
const SourceUri = "senera://memory-source/agenda-learning";
const workspaces = new Set<string>();

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("agenda learning bridge", () => {
  test("rejects only invalid drafts and preserves valid agenda writes", () => {
    const { database } = openDatabase("agenda-learning-partial");
    try {
      const bridge = createBridge(database);
      const result = bridge.apply({
        recordedTurn: recordedTurn("用户下周六去打球"),
        timeZone: TimeZone,
        now: new Date(CompletedAt),
        ranking: AgentContinuityRecallRankingDefaults,
        drafts: [
          {
            kind: "event",
            change: "create",
            actor: "user",
            summary: "用户下周六去打球",
          },
          {
            kind: "schedule",
            change: "create",
            actor: "user",
            summary: "用户下周六去打球",
            timeText: "一个无法解析的时刻",
          },
        ],
      });

      expect(result.recordedCount).toBe(1);
      expect(result.accepted).toMatchObject([
        { disposition: "created", recordId: expect.stringContaining("agenda_record_") },
      ]);
      expect(result.rejected).toEqual([
        expect.objectContaining({
          disposition: "rejected",
          draft: expect.objectContaining({ kind: "schedule" }),
          reason: expect.stringContaining("could not be resolved"),
        }),
      ]);
      expect(result.snapshot.records).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  test("reports replayed writes as idempotent instead of counting them again", () => {
    const { database } = openDatabase("agenda-learning-idempotency");
    try {
      const bridge = createBridge(database);
      const input = {
        recordedTurn: recordedTurn("用户下周六去打球"),
        timeZone: TimeZone,
        now: new Date(CompletedAt),
        ranking: AgentContinuityRecallRankingDefaults,
        drafts: [
          {
            kind: "goal" as const,
            change: "create" as const,
            actor: "user" as const,
            summary: "用户下周六去打球",
          },
        ],
      };

      const first = bridge.apply(input);
      const replay = bridge.apply(input);

      expect(first.accepted).toMatchObject([{ disposition: "created" }]);
      expect(first.recordedCount).toBe(1);
      expect(replay.accepted).toMatchObject([{ disposition: "idempotent" }]);
      expect(replay.recordedCount).toBe(0);
      expect(replay.snapshot.records).toHaveLength(1);
    } finally {
      database.close();
    }
  });
});

function openDatabase(name: string): { database: AgentSqliteDatabaseKernel } {
  const workspace = createTemporaryDirectory(name);
  workspaces.add(workspace);
  return {
    database: new AgentSqliteDatabaseKernel({
      databasePath: path.join(workspace, "memory.sqlite"),
      contract: AgentMemoryDatabaseContract,
    }),
  };
}

function createBridge(database: AgentSqliteDatabaseKernel): AgentAgendaLearningBridge {
  return new AgentAgendaLearningBridge(new AgentAgendaService({ store: new AgentAgendaSqliteStore(database) }));
}

function recordedTurn(text: string): AgentMemoryRecordedTurn {
  const episodeUri = "senera://memory-episode/agenda-learning";
  return {
    episode: {
      id: "agenda-learning",
      uri: episodeUri,
      sessionId: "session-agenda-learning",
      requestId: "request-agenda-learning",
      status: "completed",
      rawUserText: text,
      standaloneRequest: text,
      contextMode: "",
      contextBasis: "",
      topic: text,
      assistantPreview: text,
      startedAt: CompletedAt,
      completedAt: CompletedAt,
      updatedAt: CompletedAt,
      startedAtMs: Date.parse(CompletedAt),
      completedAtMs: Date.parse(CompletedAt),
      updatedAtMs: Date.parse(CompletedAt),
      timeZone: TimeZone,
      localDate: "2026-08-29",
      localHour: "09",
      metadata: {},
    },
    sources: [source(text, episodeUri)],
  };
}

function source(text: string, episodeUri: string): AgentMemorySourceRecord {
  return {
    id: "agenda-learning-source",
    uri: SourceUri,
    episodeId: "agenda-learning",
    episodeUri,
    sessionId: "session-agenda-learning",
    requestId: "request-agenda-learning",
    sourceKind: "user_message",
    role: "user",
    textContent: text,
    summary: text,
    conversationEntryId: "entry-agenda-learning",
    evidenceUri: "",
    artifactUri: "",
    toolName: "",
    createdAt: CompletedAt,
    updatedAt: CompletedAt,
    createdAtMs: Date.parse(CompletedAt),
    updatedAtMs: Date.parse(CompletedAt),
    timeZone: TimeZone,
    localDate: "2026-08-29",
    localHour: "09",
    metadata: {},
  };
}
