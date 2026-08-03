import { describe, expect, test } from "vitest";
import type { AgentConversationEntry } from "../../../Source/AgentSystem/Conversation/AgentConversation.js";
import { InMemorySessionRepository } from "../../../Source/AgentSystem/Session/AgentSqliteSessionRepository.js";
import { AgentSessionStore } from "../../../Source/AgentSystem/Session/AgentSessionStore.js";

describe("Session lazy loading behavior", () => {
  test("keeps persisted conversations out of memory until their session is first accessed", () => {
    const repository = new InstrumentedSessionRepository();
    seedSession(repository, "session-a", "request-a");
    seedSession(repository, "session-b", "request-b");

    const store = new AgentSessionStore({ repository });

    expect(repository.loadedSessionIds).toEqual([]);
    expect(store.listSessions().map((session) => session.id)).toEqual(["session-a", "session-b"]);
    expect(repository.loadedSessionIds).toEqual([]);

    expect(store.get("session-a")).toEqual(
      expect.objectContaining({
        kind: "found",
        session: expect.objectContaining({ id: "session-a", conversation: [expect.any(Object)] }),
      }),
    );
    expect(repository.loadedSessionIds).toEqual(["session-a"]);

    store.get("session-a");
    expect(repository.loadedSessionIds).toEqual(["session-a"]);

    expect(store.open("session-b").kind).toBe("existing");
    expect(repository.loadedSessionIds).toEqual(["session-a", "session-b"]);
  });

  test("bounds idle conversations while retaining sessions held by an admission", () => {
    const repository = new InstrumentedSessionRepository();
    seedSession(repository, "session-a", "request-a");
    seedSession(repository, "session-b", "request-b");
    const store = new AgentSessionStore({ repository, workingSet: { maxIdleSessions: 1 } });

    store.get("session-a");
    const release = store.retainWorkingSession("session-a");
    store.get("session-b");
    expect(repository.loadedSessionIds).toEqual(["session-a", "session-b"]);

    release();
    store.get("session-a");
    expect(repository.loadedSessionIds).toEqual(["session-a", "session-b", "session-a"]);
  });

  test("rejects invalid working-set capacity instead of coercing it", () => {
    expect(() => new AgentSessionStore({ workingSet: { maxIdleSessions: -1 } })).toThrow(/maxIdleSessions/);
    expect(() => new AgentSessionStore({ workingSet: { maxIdleSessions: 1.5 } })).toThrow(/maxIdleSessions/);
  });
});

class InstrumentedSessionRepository extends InMemorySessionRepository {
  readonly loadedSessionIds: string[] = [];

  override loadEntries(sessionId: string): AgentConversationEntry[] {
    this.loadedSessionIds.push(sessionId);
    return super.loadEntries(sessionId);
  }
}

function seedSession(repository: InMemorySessionRepository, sessionId: string, requestId: string): void {
  repository.upsertSession({
    id: sessionId,
    status: "idle",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    conversation: [],
  });
  repository.appendEntry(sessionId, {
    id: `${requestId}:user`,
    requestId,
    timestamp: "2026-01-01T00:00:00.000Z",
    kind: "user.message",
    content: requestId,
  });
}
