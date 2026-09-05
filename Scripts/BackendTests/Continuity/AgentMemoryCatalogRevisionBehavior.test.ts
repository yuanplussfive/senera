import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  AgentConversationEntryKinds,
  createConversationEntryId,
} from "../../../Source/AgentSystem/Conversation/AgentConversation.js";
import { AgentContinuitySqliteStore } from "../../../Source/AgentSystem/Continuity/AgentContinuitySqliteStore.js";
import type { AgentContinuityObservation } from "../../../Source/AgentSystem/Continuity/AgentContinuityDomain.js";
import { AgentAgendaService } from "../../../Source/AgentSystem/Agenda/AgentAgendaService.js";
import { AgentAgendaSqliteStore } from "../../../Source/AgentSystem/Agenda/AgentAgendaSqliteStore.js";
import {
  AgentAgendaActorRoles,
  AgentAgendaAuthorities,
  AgentAgendaEventKinds,
  AgentAgendaRecordKinds,
  AgentAgendaStatuses,
} from "../../../Source/AgentSystem/Agenda/AgentAgendaTypes.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { SqliteAgentMemorySourceRepository } from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import { AgentTodoService } from "../../../Source/AgentSystem/Todos/AgentTodoService.js";
import { AgentTodoSqliteStore } from "../../../Source/AgentSystem/Todos/AgentTodoSqliteStore.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

const workspaces = new Set<string>();

afterEach(() => {
  for (const workspace of workspaces) removeDirectory(workspace);
  workspaces.clear();
});

describe("physical memory catalog revision", () => {
  test("changes after recording and deleting physical turn history", () => {
    const fixture = createFixture("memory-catalog-physical-mutations");
    try {
      const initial = fixture.sources.catalogRevision();
      fixture.sources.recordCompletedTurn(completedTurn("session-1", "request-1", "第一轮"));
      const recorded = fixture.sources.catalogRevision();
      expect(recorded).not.toBe(initial);

      fixture.sources.deleteFromSessionRequest("session-1", "request-1");
      const requestDeleted = fixture.sources.catalogRevision();
      expect(requestDeleted).not.toBe(recorded);

      fixture.sources.recordCompletedTurn(completedTurn("session-1", "request-2", "第二轮"));
      const rerecorded = fixture.sources.catalogRevision();
      fixture.sources.deleteSession("session-1");
      expect(fixture.sources.catalogRevision()).not.toBe(rerecorded);
    } finally {
      fixture.close();
    }
  });

  test("does not change after continuity, Agenda, or Todo writes", () => {
    const fixture = createFixture("memory-catalog-domain-isolation");
    try {
      fixture.sources.recordCompletedTurn(completedTurn("session-2", "request-1", "用户住在上海。"));
      const physicalRevision = fixture.sources.catalogRevision();

      fixture.continuity.recordObservation(observation(fixture.workspace));
      fixture.agenda.record({
        timeZone: "Asia/Shanghai",
        kind: AgentAgendaRecordKinds.Event,
        actor: AgentAgendaActorRoles.User,
        eventKind: AgentAgendaEventKinds.Occurred,
        mutation: { summary: "整理资料", status: AgentAgendaStatuses.Recorded },
        sourceRefs: ["senera://memory-source/source-1"],
        authority: AgentAgendaAuthorities.UserExplicit,
      });
      fixture.todos.write({
        sessionId: "session-2",
        merge: false,
        items: [{ id: "todo-1", content: "读取资料" }],
      });

      expect(fixture.sources.catalogRevision()).toBe(physicalRevision);
    } finally {
      fixture.close();
    }
  });
});

function createFixture(name: string) {
  const workspace = createTemporaryDirectory(name);
  workspaces.add(workspace);
  const database = new AgentSqliteDatabaseKernel({
    databasePath: path.join(workspace, "memory.sqlite"),
    contract: AgentMemoryDatabaseContract,
  });
  return {
    workspace,
    database,
    sources: new SqliteAgentMemorySourceRepository(database),
    continuity: new AgentContinuitySqliteStore(database),
    agenda: new AgentAgendaService({ store: new AgentAgendaSqliteStore(database) }),
    todos: new AgentTodoService({
      store: new AgentTodoSqliteStore(database),
      policy: { maxItems: 16, maxContentCharacters: 1_000, maxResultCharacters: 16_000 },
    }),
    close: () => database.close(),
  };
}

function completedTurn(sessionId: string, requestId: string, content: string) {
  const timestamp = "2026-08-25T01:00:00.000Z";
  const userEntry = {
    kind: AgentConversationEntryKinds.UserMessage,
    id: createConversationEntryId(requestId, "user"),
    requestId,
    timestamp,
    content,
  } as const;
  const assistantEntry = {
    kind: AgentConversationEntryKinds.AssistantDecision,
    id: createConversationEntryId(requestId, "assistant"),
    requestId,
    timestamp,
    xml: "已记录。",
  } as const;
  return {
    sessionId,
    requestId,
    startedAt: timestamp,
    completedAt: timestamp,
    userEntry,
    assistantEntry,
    terminal: { kind: "FinalAnswer", content: "已记录。" } as const,
    executedTools: [],
  };
}

function observation(workspace: string): AgentContinuityObservation {
  return {
    id: "observation-1",
    uri: "senera://continuity-learning/observation-1",
    kind: "learning.record",
    summary: "用户住在上海。",
    payload: { kind: "fact", fact: "用户住在上海。", until: "permanent" },
    sourceRefs: ["senera://memory-source/source-1"],
    watermark: "watermark-1",
    scope: { kind: "user", id: workspace },
    authority: "user_explicit",
    confidence: 1,
    occurredAt: "2026-08-25T01:00:00.000Z",
    observedAt: "2026-08-25T01:00:01.000Z",
    createdAtMs: Date.parse("2026-08-25T01:00:01.000Z"),
  };
}
