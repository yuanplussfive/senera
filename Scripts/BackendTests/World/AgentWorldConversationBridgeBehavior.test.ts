import path from "node:path";
import { describe, expect, test } from "vitest";
import { AgentAgendaService } from "../../../Source/AgentSystem/Agenda/AgentAgendaService.js";
import { AgentAgendaSqliteStore } from "../../../Source/AgentSystem/Agenda/AgentAgendaSqliteStore.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { AgentMemoryService } from "../../../Source/AgentSystem/Memory/AgentMemoryService.js";
import { InMemoryAgentMemorySourceRepository } from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import { AgentWorldConversationBridge } from "../../../Source/AgentSystem/World/AgentWorldConversationBridge.js";
import { AgentWorldEventLedger } from "../../../Source/AgentSystem/World/AgentWorldEventLedger.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

describe("world conversation bridge", () => {
  test("records an evidence-backed turn and removes it with the source session", () => {
    const workspace = createTemporaryDirectory("senera-world-conversation");
    const database = new AgentSqliteDatabaseKernel({
      databasePath: path.join(workspace, "memory.sqlite"),
      contract: AgentMemoryDatabaseContract,
    });
    try {
      const agenda = new AgentAgendaService({ store: new AgentAgendaSqliteStore(database) });
      const ledger = new AgentWorldEventLedger(database, agenda);
      const bridge = new AgentWorldConversationBridge({
        ledger,
        agenda,
        timeZone: () => "Asia/Shanghai",
      });
      const memory = new AgentMemoryService({
        sourceRepository: new InMemoryAgentMemorySourceRepository(),
        completedTurnSinks: [bridge],
        deletionSinks: [bridge],
      });
      const completedAt = "2026-09-01T08:00:00.000Z";

      memory.recordCompletedTurn({
        sessionId: "session-test",
        requestId: "request-test",
        startedAt: "2026-09-01T07:59:00.000Z",
        completedAt,
        userEntry: {
          id: "request-test:user",
          requestId: "request-test",
          timestamp: completedAt,
          kind: "user.message",
          content: "我今天想整理房间。",
        },
        assistantEntry: {
          id: "request-test:assistant",
          requestId: "request-test",
          timestamp: completedAt,
          kind: "assistant.decision",
          xml: "<agent_result />",
        },
        terminal: { kind: "FinalAnswer", content: "好呀，我先陪你列一下。" },
        executedTools: [],
      });

      const recorded = ledger
        .snapshot("Asia/Shanghai")
        .events.filter((event) => event.type === "conversation.turn.completed");
      expect(recorded).toHaveLength(1);
      expect(recorded[0]).toMatchObject({
        summary: "user：我今天想整理房间。\nresident：好呀，我先陪你列一下。",
        evidenceRefs: expect.arrayContaining([expect.stringContaining("senera://memory-episode/")]),
      });

      memory.deleteSession("session-test");
      expect(
        ledger.snapshot("Asia/Shanghai").events.filter((event) => event.type === "conversation.turn.completed"),
      ).toHaveLength(0);
    } finally {
      database.close();
      removeDirectory(workspace);
    }
  });
});
