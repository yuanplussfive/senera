import path from "node:path";
import { describe, expect, test } from "vitest";
import { AgentAgendaService } from "../../../Source/AgentSystem/Agenda/AgentAgendaService.js";
import { AgentAgendaSqliteStore } from "../../../Source/AgentSystem/Agenda/AgentAgendaSqliteStore.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentEventKinds, type AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { AgentWorldEventLedger } from "../../../Source/AgentSystem/World/AgentWorldEventLedger.js";
import { AgentWorldLifecycleEventBridge } from "../../../Source/AgentSystem/World/AgentWorldLifecycleEventBridge.js";
import { AgentWorldConversationBridge } from "../../../Source/AgentSystem/World/AgentWorldConversationBridge.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

describe("world lifecycle event bridge", () => {
  test("projects tool lifecycle and keeps duplicate observations idempotent", () => {
    const workspace = createTemporaryDirectory("senera-world-lifecycle");
    const database = new AgentSqliteDatabaseKernel({
      databasePath: path.join(workspace, "memory.sqlite"),
      contract: AgentMemoryDatabaseContract,
    });
    try {
      const agenda = new AgentAgendaService({ store: new AgentAgendaSqliteStore(database) });
      const ledger = new AgentWorldEventLedger(database, agenda);
      const bridge = new AgentWorldLifecycleEventBridge({
        ledger,
        agenda,
        timeZone: () => "Asia/Shanghai",
        now: () => "2026-09-01T08:01:00.000Z",
      });
      const started: AgentDomainEvent = {
        kind: AgentEventKinds.ToolCallStarted,
        context: { sessionId: "session-test", requestId: "request-test", step: 1 },
        data: {
          index: 0,
          toolName: "browser",
          callId: "call-test",
          purpose: "查看页面",
          startedAt: "2026-09-01T08:00:59.000Z",
        },
      };
      const completed: AgentDomainEvent = {
        kind: AgentEventKinds.ToolCallCompleted,
        context: { sessionId: "session-test", requestId: "request-test", step: 1 },
        data: {
          index: 0,
          toolName: "browser",
          callId: "call-test",
          startedAt: "2026-09-01T08:00:59.000Z",
          durationMs: 1_000,
          presentation: {
            type: "senera.tool_result_presentation.v1",
            version: 1,
            status: "success",
            headline: "页面已打开",
            facts: [],
            evidence: [],
            changes: [],
          },
        },
      };

      bridge.observe(started);
      bridge.observe(completed);
      bridge.observe(completed);

      const events = ledger.snapshot("Asia/Shanghai").events.filter((event) => event.type.startsWith("tool."));
      expect(events).toHaveLength(2);
      expect(events.map((event) => event.summary)).toEqual([
        "{{resident}}开始browser：查看页面",
        "{{resident}}完成browser：页面已打开",
      ]);
      expect(events[1].evidenceRefs).toEqual(
        expect.arrayContaining([expect.stringContaining("senera://event/"), "senera://session/session-test"]),
      );
      expect(events[1].changes[0]).toMatchObject({
        kind: "entity_upsert",
        entity: { attributes: { lifecycle: "completed", headline: "页面已打开", durationMs: 1_000 } },
      });

      bridge.deleteSources({ sessionId: "session-test", episodeUris: [], sourceUris: [] });
      expect(ledger.snapshot("Asia/Shanghai").events.filter((event) => event.type.startsWith("tool."))).toHaveLength(0);
    } finally {
      database.close();
      removeDirectory(workspace);
    }
  });

  test("deletes request-scoped lifecycle events and treats empty conversation impact as a no-op", () => {
    const workspace = createTemporaryDirectory("senera-world-lifecycle-delete");
    const database = new AgentSqliteDatabaseKernel({
      databasePath: path.join(workspace, "memory.sqlite"),
      contract: AgentMemoryDatabaseContract,
    });
    try {
      const agenda = new AgentAgendaService({ store: new AgentAgendaSqliteStore(database) });
      const ledger = new AgentWorldEventLedger(database, agenda);
      const bridge = new AgentWorldLifecycleEventBridge({
        ledger,
        agenda,
        timeZone: () => "Asia/Shanghai",
        now: () => "2026-09-01T08:01:00.000Z",
      });
      const event = (requestId: string, callId: string): AgentDomainEvent => ({
        kind: AgentEventKinds.ToolCallStarted,
        context: { sessionId: "session-test", requestId, step: 1 },
        data: {
          index: 0,
          toolName: "browser",
          callId,
          purpose: "查看页面",
          startedAt: "2026-09-01T08:00:59.000Z",
        },
      });

      bridge.observe(event("request-a", "call-a"));
      bridge.observe(event("request-b", "call-b"));
      expect(ledger.snapshot("Asia/Shanghai").events.filter((entry) => entry.type === "tool.started")).toHaveLength(2);

      bridge.deleteSources({
        sessionId: "session-test",
        scope: "from_request",
        requestId: "request-a",
        episodeUris: [],
        sourceUris: [],
      });
      const remaining = ledger.snapshot("Asia/Shanghai").events.filter((entry) => entry.type === "tool.started");
      expect(remaining).toHaveLength(1);
      expect(remaining[0].evidenceRefs).toContain("senera://request/request-b");

      const conversationBridge = new AgentWorldConversationBridge({
        ledger,
        agenda,
        timeZone: () => "Asia/Shanghai",
      });
      expect(() =>
        conversationBridge.deleteSources({ sessionId: "session-test", episodeUris: [], sourceUris: [] }),
      ).not.toThrow();
    } finally {
      database.close();
      removeDirectory(workspace);
    }
  });
});
