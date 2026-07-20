import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  AgentEventChannels,
  AgentEventKinds,
  AgentEventLayers,
  AgentEventPhases,
} from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { SqliteSessionRepository } from "../../../Source/AgentSystem/Session/AgentSqliteSessionRepository.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";

describe("SQLite session repository behavior", () => {
  test("round-trips session metadata, entries, run events, snapshots, traces, and profile settings", () => {
    const fixture = createRepository();
    const { repository } = fixture;
    try {
      const session = {
        id: "session-sqlite",
        title: "Original title",
        status: "idle" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
        conversation: [],
        metadata: { title: "Original title" },
      };

      repository.upsertSession(session);
      repository.appendEntries(session.id, [
        { sequence: 0, entry: userEntry("request-a", "Read workspace") },
        { sequence: 1, entry: assistantEntry("request-a", "Done") },
      ]);
      repository.persistTurnArtifacts(
        session.id,
        [{ sequence: 2, entry: userEntry("request-b", "Run tests") }],
        [
          {
            requestId: "request-b",
            turnSequence: 2,
            trace: { step: 1, seq: 0, kind: "tool", status: "done" },
          },
        ],
      );
      repository.appendRunEvent(session.id, {
        channel: AgentEventChannels.AgentEvent,
        kind: AgentEventKinds.RunStarted,
        layer: AgentEventLayers.Progress,
        phase: AgentEventPhases.Run,
        requestId: "request-b",
        sessionId: session.id,
        timestamp: "2026-01-01T00:00:02.000Z",
        sequence: 1,
        data: { input: "Run tests" },
      });
      repository.upsertRunSnapshot({
        sessionId: session.id,
        requestId: "request-b",
        input: "Run tests",
        status: "completed",
        startedAt: "2026-01-01T00:00:02.000Z",
        updatedAt: "2026-01-01T00:00:03.000Z",
        endedAt: "2026-01-01T00:00:03.000Z",
      });
      const profile = repository.saveUserProfile({ name: "Ada" });
      repository.renameSession(session.id, "Renamed session");

      expect(repository.listSessions()).toEqual([
        expect.objectContaining({
          id: session.id,
          entryCount: 3,
          messageCount: 3,
          metadata: expect.objectContaining({
            title: "Renamed session",
          }),
        }),
      ]);
      expect(repository.loadSession(session.id)).toEqual(
        expect.objectContaining({
          id: session.id,
          metadata: expect.objectContaining({
            title: "Renamed session",
          }),
          conversation: [
            expect.objectContaining({ requestId: "request-a", kind: "user.message" }),
            expect.objectContaining({ requestId: "request-a", kind: "assistant.decision" }),
            expect.objectContaining({ requestId: "request-b", kind: "user.message" }),
          ],
        }),
      );
      expect(repository.loadStepTraces(session.id)).toEqual([
        expect.objectContaining({ requestId: "request-b", traces: [expect.objectContaining({ kind: "tool" })] }),
      ]);
      expect(repository.loadRunEvents(session.id)).toEqual([
        expect.objectContaining({ kind: AgentEventKinds.RunStarted, requestId: "request-b" }),
      ]);
      expect(repository.loadRunSnapshots(session.id)).toEqual([
        expect.objectContaining({ requestId: "request-b", status: "completed" }),
      ]);
      expect(repository.loadUserProfile()).toEqual(
        expect.objectContaining({
          name: profile.name,
          avatarDataUrl: null,
        }),
      );
    } finally {
      fixture.cleanup();
    }
  });

  test("deletes entries, run events, traces, and snapshots from a request boundary", () => {
    const fixture = createRepository();
    const { repository } = fixture;
    try {
      repository.upsertSession({
        id: "session-delete",
        status: "idle",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        conversation: [],
      });
      repository.appendEntries("session-delete", [
        { sequence: 0, entry: userEntry("request-a", "A") },
        { sequence: 1, entry: userEntry("request-b", "B") },
        { sequence: 2, entry: userEntry("request-c", "C") },
      ]);
      repository.persistTurnArtifacts(
        "session-delete",
        [],
        [
          { requestId: "request-a", turnSequence: 0, trace: { step: 1, seq: 0, kind: "answer", status: "done" } },
          { requestId: "request-b", turnSequence: 1, trace: { step: 1, seq: 0, kind: "answer", status: "done" } },
        ],
      );
      for (const requestId of ["request-a", "request-b", "request-c"]) {
        repository.appendRunEvent("session-delete", {
          channel: AgentEventChannels.AgentEvent,
          kind: AgentEventKinds.RunStarted,
          layer: AgentEventLayers.Progress,
          phase: AgentEventPhases.Run,
          requestId,
          sessionId: "session-delete",
          timestamp: "2026-01-01T00:00:00.000Z",
          sequence: Number(requestId.at(-1)?.charCodeAt(0) ?? 0),
          data: {},
        });
        repository.upsertRunSnapshot({
          sessionId: "session-delete",
          requestId,
          input: requestId,
          status: "completed",
          startedAt: `2026-01-01T00:00:0${requestId.at(-1) === "a" ? 1 : requestId.at(-1) === "b" ? 2 : 3}.000Z`,
          updatedAt: "2026-01-01T00:00:04.000Z",
        });
      }

      const removed = repository.truncateFromRequest("session-delete", "request-b");

      expect(repository.loadEntries("session-delete").map((entry) => entry.requestId)).toEqual(["request-a"]);
      expect(removed).toBe(2);
      expect(repository.loadRunEvents("session-delete")).toHaveLength(1);
      expect(repository.loadStepTraces("session-delete").map((run) => run.requestId)).toEqual(["request-a"]);
      expect(repository.loadRunSnapshots("session-delete").map((snapshot) => snapshot.requestId)).toEqual([
        "request-a",
      ]);
      expect(repository.deleteSession("session-delete")).toBe(true);
      expect(repository.loadSession("session-delete")).toBeUndefined();
    } finally {
      fixture.cleanup();
    }
  });

  test("rolls back the entire turn commit when a terminal event cannot be serialized", () => {
    const fixture = createRepository();
    const { repository } = fixture;
    try {
      repository.upsertSession({
        id: "session-atomic-turn",
        status: "idle",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        conversation: [],
      });

      expect(() =>
        repository.persistTurnCommit({
          sessionId: "session-atomic-turn",
          requestId: "request-atomic-turn",
          session: {
            id: "session-atomic-turn",
            status: "running",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:01.000Z",
            activeRequest: {
              requestId: "request-atomic-turn",
              input: "Commit atomically",
              startedAt: "2026-01-01T00:00:00.000Z",
            },
            conversation: [],
          },
          entries: [{ sequence: 0, entry: userEntry("request-atomic-turn", "Commit atomically") }],
          traces: [
            {
              requestId: "request-atomic-turn",
              turnSequence: 0,
              trace: { step: 1, seq: 0, kind: "answer", status: "done" },
            },
          ],
          snapshot: {
            sessionId: "session-atomic-turn",
            requestId: "request-atomic-turn",
            input: "Commit atomically",
            status: "completed",
            startedAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:01.000Z",
            endedAt: "2026-01-01T00:00:01.000Z",
          },
          runEvents: [
            {
              eventId: "event-atomic-turn",
              channel: AgentEventChannels.AgentEvent,
              kind: AgentEventKinds.RunCompleted,
              layer: AgentEventLayers.Terminal,
              phase: AgentEventPhases.Run,
              requestId: "request-atomic-turn",
              sessionId: "session-atomic-turn",
              timestamp: "2026-01-01T00:00:01.000Z",
              sequence: 1,
              data: { unserializable: 1n },
            },
          ],
        }),
      ).toThrow();

      expect(repository.loadEntries("session-atomic-turn")).toEqual([]);
      expect(repository.loadSession("session-atomic-turn")).toEqual(expect.objectContaining({ status: "idle" }));
      expect(repository.loadStepTraces("session-atomic-turn")).toEqual([]);
      expect(repository.loadRunSnapshots("session-atomic-turn")).toEqual([]);
      expect(repository.loadRunEvents("session-atomic-turn")).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });
});

function createRepository(): { repository: SqliteSessionRepository; cleanup: () => void } {
  const dir = createTemporaryDirectory("senera-session-repository");
  const repository = new SqliteSessionRepository(path.join(dir, "session.db"));
  return {
    repository,
    cleanup: () => {
      repository.close();
      removeDirectory(dir);
    },
  };
}

function userEntry(requestId: string, content: string) {
  return {
    id: `${requestId}:user`,
    requestId,
    timestamp: "2026-01-01T00:00:00.000Z",
    kind: "user.message" as const,
    content,
  };
}

function assistantEntry(requestId: string, xml: string) {
  return {
    id: `${requestId}:assistant`,
    requestId,
    timestamp: "2026-01-01T00:00:01.000Z",
    kind: "assistant.decision" as const,
    xml,
  };
}
