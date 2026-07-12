import { describe, expect, test, vi } from "vitest";
import {
  AgentEventChannels,
  AgentEventKinds,
  AgentEventLayers,
  AgentEventPhases,
  type AgentDomainEvent,
} from "../../../Source/AgentSystem/Events/AgentEvent.js";
import type { AgentLoopRunner } from "../../../Source/AgentSystem/Loop/AgentLoopRunner.js";
import { AgentMemoryService } from "../../../Source/AgentSystem/Memory/AgentMemoryService.js";
import { InMemoryAgentMemorySourceRepository } from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import { AgentSessionManager } from "../../../Source/AgentSystem/Session/AgentSessionManager.js";
import {
  InMemorySessionRepository,
  SqliteSessionRepository,
} from "../../../Source/AgentSystem/Session/AgentSqliteSessionRepository.js";
import { AgentSessionStore } from "../../../Source/AgentSystem/Session/AgentSessionStore.js";
import { AgentCancellationError } from "../../../Source/AgentSystem/Core/AgentCancellation.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import path from "node:path";

describe("Session manager behavior", () => {
  test("creates sessions, bootstraps Pi, and emits snapshots for existing sessions", async () => {
    const bootstrap = vi.fn(async () => {});
    const fixture = createManagerFixture({
      piSessionBootstrap: { bootstrap },
    });
    const events: AgentDomainEvent[] = [];

    await fixture.manager.createSession({
      sessionId: "session-managed",
      modelProviderId: "provider-a",
      onEvent: collect(events),
    });
    await fixture.manager.createSession({
      sessionId: "session-managed",
      modelProviderId: "provider-a",
      onEvent: collect(events),
    });

    expect(events.map((event) => event.kind)).toEqual([
      AgentEventKinds.SessionCreated,
      AgentEventKinds.SessionSnapshot,
    ]);
    expect(bootstrap).toHaveBeenCalledTimes(2);
    expect(bootstrap).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sessionId: "session-managed",
        modelProviderId: "provider-a",
      }),
    );
    expect(fixture.manager.listSessions()).toEqual([
      expect.objectContaining({
        sessionId: "session-managed",
        status: "idle",
        entryCount: 0,
        messageCount: 0,
      }),
    ]);
  });

  test("reports missing sessions and closes existing sessions with memory cleanup", async () => {
    const memoryRepository = new InMemoryAgentMemorySourceRepository();
    const fixture = createManagerFixture({
      memoryService: new AgentMemoryService({ sourceRepository: memoryRepository }),
    });
    const deleteSession = vi.spyOn(memoryRepository, "deleteSession");
    const events: AgentDomainEvent[] = [];

    await fixture.manager.closeSession({ sessionId: "missing", onEvent: collect(events) });
    await fixture.manager.createSession({ sessionId: "session-close" });
    await fixture.manager.closeSession({ sessionId: "session-close", onEvent: collect(events) });

    expect(events.map((event) => event.kind)).toEqual([AgentEventKinds.SessionNotFound, AgentEventKinds.SessionClosed]);
    expect(deleteSession).toHaveBeenCalledWith("session-close");
    expect(fixture.store.get("session-close")).toEqual({ kind: "missing", sessionId: "session-close" });
  });

  test("renames sessions, emits session list snapshots, and preserves persisted title", async () => {
    const dir = createTemporaryDirectory("senera-session-manager");
    const repository = new SqliteSessionRepository(path.join(dir, "session.db"));
    try {
      const fixture = createManagerFixture({ repository });
      const events: AgentDomainEvent[] = [];

      await fixture.manager.createSession({ sessionId: "session-title" });
      await fixture.manager.renameSession({
        sessionId: "session-title",
        title: "Release investigation",
        onEvent: collect(events),
      });
      await fixture.manager.emitSessionListSnapshot({ onEvent: collect(events) });

      expect(events.map((event) => event.kind)).toEqual([
        AgentEventKinds.SessionSnapshot,
        AgentEventKinds.SessionListSnapshot,
      ]);
      expect(fixture.manager.listSessions()).toEqual([
        expect.objectContaining({
          sessionId: "session-title",
          title: "Release investigation",
        }),
      ]);
    } finally {
      repository.close();
      removeDirectory(dir);
    }
  });

  test("truncates conversation, run history, and memory from a request boundary", async () => {
    const memoryRepository = new InMemoryAgentMemorySourceRepository();
    const fixture = createManagerFixture({
      memoryService: new AgentMemoryService({ sourceRepository: memoryRepository }),
    });
    const deleteFromSessionRequest = vi.spyOn(memoryRepository, "deleteFromSessionRequest");
    const events: AgentDomainEvent[] = [];
    await fixture.manager.createSession({ sessionId: "session-truncate" });
    fixture.store.persistEntries("session-truncate", [
      userEntry("request-a", "A"),
      assistantEntry("request-a", "Answer A"),
      userEntry("request-b", "B"),
      assistantEntry("request-b", "Answer B"),
    ]);
    fixture.manager.recordRunEvent(runEvent("session-truncate", "request-a", 1));
    fixture.manager.recordRunEvent(runEvent("session-truncate", "request-b", 2));

    await fixture.manager.truncateFromRequest({
      sessionId: "session-truncate",
      requestId: "request-b",
      onEvent: collect(events),
    });

    expect(fixture.store.loadConversation("session-truncate").map((entry) => entry.requestId)).toEqual([
      "request-a",
      "request-a",
    ]);
    expect(fixture.store.loadRunEvents("session-truncate").map((event) => event.requestId)).toEqual(["request-a"]);
    expect(deleteFromSessionRequest).toHaveBeenCalledWith("session-truncate", "request-b");
    expect(events).toEqual([
      expect.objectContaining({
        kind: AgentEventKinds.SessionTruncated,
        data: expect.objectContaining({ removedEntries: 2 }),
      }),
    ]);
  });

  test("routes submitMessage missing and busy paths through stable events", async () => {
    const pendingLoop = createPendingLoop();
    const fixture = createManagerFixture({ loopFactory: () => pendingLoop.loop });
    const events: AgentDomainEvent[] = [];

    await fixture.manager.submitMessage({
      sessionId: "missing-session",
      input: "hello",
      onEvent: collect(events),
    });
    await fixture.manager.createSession({ sessionId: "session-busy" });
    const run = fixture.manager.submitMessage({
      sessionId: "session-busy",
      requestId: "request-running",
      input: "long run",
    });
    await pendingLoop.started;
    await fixture.manager.submitMessage({
      sessionId: "session-busy",
      requestId: "request-busy",
      input: "second turn",
      onEvent: collect(events),
    });
    await expect(fixture.manager.cancelActiveRun({ sessionId: "session-busy" })).resolves.toBe(true);
    await run;

    expect(events.map((event) => event.kind)).toEqual([AgentEventKinds.SessionNotFound, AgentEventKinds.SessionBusy]);
  });
});

function createManagerFixture(
  options: Partial<ConstructorParameters<typeof AgentSessionManager>[0]> & {
    repository?: InMemorySessionRepository | SqliteSessionRepository;
  } = {},
) {
  const repository = options.repository ?? new InMemorySessionRepository();
  const store = new AgentSessionStore({ repository });
  const { repository: _repository, ...managerOptions } = options;
  const manager = new AgentSessionManager({
    loopFactory: () => ({ run: async () => completedRun("generated-request") }),
    store,
    ...managerOptions,
  });
  return { manager, repository, store };
}

function collect(events: AgentDomainEvent[]) {
  return (event: AgentDomainEvent) => {
    events.push(event);
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

function runEvent(sessionId: string, requestId: string, sequence: number) {
  return {
    channel: AgentEventChannels.AgentEvent,
    kind: AgentEventKinds.RunStarted,
    layer: AgentEventLayers.Progress,
    phase: AgentEventPhases.Run,
    context: { sessionId, requestId },
    sessionId,
    requestId,
    sequence,
    timestamp: "2026-01-01T00:00:00.000Z",
    data: { input: requestId },
  } as const;
}

function completedRun(requestId: string) {
  return {
    terminal: { kind: "FinalAnswer" as const, content: "done" },
    decisionXml: "<agent_result><final_answer>done</final_answer></agent_result>",
    usage: { source: "local_estimate" as const, inputTokens: 1, outputTokens: 1 },
    conversationEntries: [assistantEntry(requestId, "done")],
    stepTraces: [],
  };
}

function createPendingLoop(): { loop: AgentLoopRunner; started: Promise<void> } {
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  return {
    started,
    loop: {
      run: async (request) => {
        markStarted();
        return new Promise((_resolve, reject) => {
          const rejectCancellation = () =>
            reject(request.signal?.reason instanceof Error ? request.signal.reason : new AgentCancellationError());
          if (request.signal?.aborted) {
            rejectCancellation();
            return;
          }
          request.signal?.addEventListener("abort", rejectCancellation, { once: true });
        });
      },
    },
  };
}
