import { describe, expect, test, vi } from "vitest";
import { AgentEventKinds, type AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentMemoryService } from "../../../Source/AgentSystem/Memory/AgentMemoryService.js";
import { InMemoryAgentMemorySourceRepository } from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import { SqliteSessionRepository } from "../../../Source/AgentSystem/Session/AgentSqliteSessionRepository.js";
import { AgentCancellationError } from "../../../Source/AgentSystem/Core/AgentCancellation.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import path from "node:path";
import {
  AgentPiSessionLifecycleStates,
  withAgentPiSessionLifecycle,
} from "../../../Source/AgentSystem/Pi/AgentPiSessionLifecycleMetadata.js";
import { AgentPiActiveSessionRegistry } from "../../../Source/AgentSystem/Pi/AgentPiActiveSessionRegistry.js";
import type { AgentPiSession } from "../../../Source/AgentSystem/Pi/AgentPiSubstrate.js";
import { AgentSessionMessageQueueModes } from "../../../Source/AgentSystem/Session/AgentSessionMessageQueueMode.js";
import { createDeferred, waitForAbort } from "../Support/AsyncTestFixtures.js";
import {
  assistantEntry,
  collect,
  completedRun,
  createManagerFixture,
  createPendingLoop,
  runEvent,
  userEntry,
} from "./SessionManagerTestFixtures.js";

describe("Session manager behavior", () => {
  test("creates sessions without opening Pi and emits snapshots for existing sessions", async () => {
    const rewind = vi.fn(async () => false);
    const reset = vi.fn(async () => false);
    const fixture = createManagerFixture({ piSessionMutations: { rewind, reset } });
    const events: AgentDomainEvent[] = [];

    await fixture.manager.createSession({
      sessionId: "session-managed",
      onEvent: collect(events),
    });
    await fixture.manager.createSession({
      sessionId: "session-managed",
      onEvent: collect(events),
    });

    expect(events.map((event) => event.kind)).toEqual([
      AgentEventKinds.SessionCreated,
      AgentEventKinds.SessionSnapshot,
    ]);
    expect(rewind).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    expect(fixture.manager.listSessions()).toEqual([
      expect.objectContaining({
        sessionId: "session-managed",
        status: "idle",
        entryCount: 0,
        messageCount: 0,
      }),
    ]);
  });

  test("atomically creates a missing session with its first message", async () => {
    const fixture = createManagerFixture();
    const events: AgentDomainEvent[] = [];

    await fixture.manager.submitMessage({
      sessionId: "session-first-message",
      requestId: "request-first-message",
      modelProviderId: "provider-first-message",
      input: "Create and run in one command",
      disposition: "create_if_missing",
      onEvent: collect(events),
    });

    expect(events[0]).toEqual(expect.objectContaining({ kind: AgentEventKinds.SessionCreated }));
    const conversation = fixture.store.loadConversation("session-first-message");
    expect(conversation[0]).toEqual(
      expect.objectContaining({ kind: "user.message", requestId: "request-first-message" }),
    );
    expect(conversation.at(-1)).toEqual(
      expect.objectContaining({ kind: "assistant.decision", requestId: "request-first-message" }),
    );
    expect(fixture.manager.listSessions()).toEqual([
      expect.objectContaining({ sessionId: "session-first-message", messageCount: conversation.length }),
    ]);
  });

  test("reports missing sessions and closes existing sessions with memory cleanup", async () => {
    const memoryRepository = new InMemoryAgentMemorySourceRepository();
    const reset = vi.fn(async () => true);
    const releaseSessionResource = vi.fn(async () => undefined);
    const fixture = createManagerFixture({
      memoryService: new AgentMemoryService({ sourceRepository: memoryRepository }),
      piSessionMutations: { rewind: vi.fn(async () => false), reset },
      sessionResources: [{ id: "execution-resources", release: releaseSessionResource }],
    });
    const deleteSession = vi.spyOn(memoryRepository, "deleteSession");
    const events: AgentDomainEvent[] = [];

    await fixture.manager.closeSession({ sessionId: "missing", onEvent: collect(events) });
    await fixture.manager.createSession({ sessionId: "session-close" });
    await fixture.manager.closeSession({ sessionId: "session-close", onEvent: collect(events) });

    expect(events.map((event) => event.kind)).toEqual([AgentEventKinds.SessionNotFound, AgentEventKinds.SessionClosed]);
    expect(deleteSession).toHaveBeenCalledWith("session-close");
    expect(releaseSessionResource).toHaveBeenCalledWith({ sessionId: "session-close" });
    expect(reset).not.toHaveBeenCalled();
    expect(fixture.store.get("session-close")).toEqual({ kind: "missing", sessionId: "session-close" });
  });

  test("retains a durable close marker and retries after infrastructure cleanup fails", async () => {
    let shouldFail = true;
    const fixture = createManagerFixture({
      sessionResources: [
        {
          id: "failing-resource",
          release: async () => {
            if (shouldFail) throw new Error("resource cleanup failed");
          },
        },
      ],
    });
    await fixture.manager.createSession({ sessionId: "session-cleanup-failure" });

    await expect(fixture.manager.closeSession({ sessionId: "session-cleanup-failure" })).rejects.toThrow(
      "resource cleanup failed",
    );

    expect(fixture.store.get("session-cleanup-failure")).toEqual(
      expect.objectContaining({
        kind: "found",
        session: expect.objectContaining({
          metadata: expect.objectContaining({
            lifecycle: expect.objectContaining({
              close: expect.objectContaining({ state: "cleanup_failed", attempts: 1 }),
            }),
          }),
        }),
      }),
    );

    shouldFail = false;
    await fixture.manager.closeSession({ sessionId: "session-cleanup-failure" });
    expect(fixture.store.get("session-cleanup-failure")).toEqual({
      kind: "missing",
      sessionId: "session-cleanup-failure",
    });
  });

  test("persists close intent before releasing external resources", async () => {
    const observedStates: Array<string | undefined> = [];
    const fixture = createManagerFixture({
      sessionResources: [
        {
          id: "intent-observer",
          release: async () => {
            const lookup = fixture.store.get("session-close-intent");
            observedStates.push(lookup.kind === "found" ? lookup.session.metadata?.lifecycle?.close?.state : undefined);
          },
        },
      ],
    });
    await fixture.manager.createSession({ sessionId: "session-close-intent" });

    await fixture.manager.closeSession({ sessionId: "session-close-intent" });

    expect(observedStates).toEqual(["cleanup_pending"]);
  });

  test("releases session resources only after the active run has settled", async () => {
    const activeStarted = createDeferred<void>();
    const cancellationObserved = createDeferred<void>();
    const allowRunToSettle = createDeferred<void>();
    const order: string[] = [];
    const release = vi.fn(async () => {
      order.push("resource_released");
    });
    const fixture = createManagerFixture({
      sessionResources: [{ id: "execution-resources", release }],
      loopFactory: () => ({
        run: async (request) => {
          activeStarted.resolve();
          await waitForAbort(request.signal);
          cancellationObserved.resolve();
          await allowRunToSettle.promise;
          order.push("run_settled");
          throw request.signal?.reason instanceof Error ? request.signal.reason : new AgentCancellationError();
        },
      }),
    });
    await fixture.manager.createSession({ sessionId: "session-close-active" });
    const run = fixture.manager.submitMessage({
      sessionId: "session-close-active",
      requestId: "request-close-active",
      input: "Keep running",
    });
    await activeStarted.promise;

    const close = fixture.manager.closeSession({ sessionId: "session-close-active" });
    await cancellationObserved.promise;
    expect(release).not.toHaveBeenCalled();

    allowRunToSettle.resolve();
    await Promise.all([run, close]);

    expect(order).toEqual(["run_settled", "resource_released"]);
    expect(fixture.store.get("session-close-active")).toEqual({
      kind: "missing",
      sessionId: "session-close-active",
    });
  });

  test("marks Pi initialized at the first turn boundary and resets it on close", async () => {
    const reset = vi.fn(async () => true);
    const fixture = createManagerFixture({
      piSessionMutations: { rewind: vi.fn(async () => false), reset },
      loopFactory: () => ({
        run: async (request) => {
          await request.onPiBranchBoundary?.("boundary-first-turn");
          return completedRun("request-first-turn");
        },
      }),
    });
    await fixture.manager.createSession({ sessionId: "session-lazy-pi" });

    await fixture.manager.submitMessage({
      sessionId: "session-lazy-pi",
      requestId: "request-first-turn",
      modelProviderId: "provider-lazy",
      input: "Inspect the workspace",
    });

    expect(fixture.store.get("session-lazy-pi")).toEqual(
      expect.objectContaining({
        session: expect.objectContaining({
          metadata: expect.objectContaining({
            piSession: expect.objectContaining({
              state: AgentPiSessionLifecycleStates.Initialized,
              modelProviderId: "provider-lazy",
            }),
          }),
        }),
      }),
    );

    await fixture.manager.closeSession({ sessionId: "session-lazy-pi" });
    expect(reset).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session-lazy-pi", modelProviderId: "provider-lazy" }),
    );
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
      await fixture.manager.submitMessage({
        sessionId: "session-title",
        requestId: "request-after-rename",
        input: "Continue the investigation",
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
      expect(repository.loadSession("session-title")?.metadata?.title).toBe("Release investigation");
    } finally {
      repository.close();
      removeDirectory(dir);
    }
  });

  test("truncates conversation, run history, and memory from a request boundary", async () => {
    const memoryRepository = new InMemoryAgentMemorySourceRepository();
    const reset = vi.fn(async () => true);
    const rewind = vi.fn(async () => false);
    const fixture = createManagerFixture({
      memoryService: new AgentMemoryService({ sourceRepository: memoryRepository }),
      piSessionMutations: { rewind, reset },
    });
    const deleteFromSessionRequest = vi.spyOn(memoryRepository, "deleteFromSessionRequest");
    const events: AgentDomainEvent[] = [];
    await fixture.manager.createSession({ sessionId: "session-truncate" });
    const truncateSession = fixture.store.get("session-truncate");
    if (truncateSession.kind === "found") {
      truncateSession.session.metadata = withAgentPiSessionLifecycle(
        truncateSession.session.metadata,
        AgentPiSessionLifecycleStates.Initialized,
      );
      fixture.store.persistMetadata(truncateSession.session);
    }
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
    expect(reset).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session-truncate" }));
    expect(events).toEqual([
      expect.objectContaining({
        kind: AgentEventKinds.SessionTruncated,
        data: expect.objectContaining({ removedEntries: 2 }),
      }),
    ]);
  });

  test("routes submitMessage missing and busy paths through stable events", async () => {
    const pendingLoop = createPendingLoop();
    const piSessions = new AgentPiActiveSessionRegistry();
    const fixture = createManagerFixture({ loopFactory: () => pendingLoop.loop, piSessions });
    const events: AgentDomainEvent[] = [];
    const steer = vi.fn(async () => undefined);
    const followUp = vi.fn(async () => undefined);

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
    const unregister = piSessions.register({
      sessionId: "session-busy",
      requestId: "request-running",
      step: 1,
      session: {
        steer,
        followUp,
        abort: async () => undefined,
      } as unknown as AgentPiSession,
    });
    await fixture.manager.submitMessage({
      sessionId: "session-busy",
      requestId: "request-busy",
      input: "second turn",
      onEvent: collect(events),
    });
    await fixture.manager.submitMessage({
      sessionId: "session-busy",
      requestId: "request-steer",
      input: "change direction",
      queueMode: AgentSessionMessageQueueModes.Steer,
    });
    await fixture.manager.submitMessage({
      sessionId: "session-busy",
      requestId: "request-follow-up",
      input: "continue afterwards",
      queueMode: AgentSessionMessageQueueModes.FollowUp,
    });
    expect(fixture.store.loadConversation("session-busy").map((entry) => entry.requestId)).toEqual([
      "request-running",
      "request-steer",
      "request-follow-up",
    ]);
    unregister();
    await expect(fixture.manager.cancelActiveRun({ sessionId: "session-busy" })).resolves.toBe(true);
    await run;

    expect(events.map((event) => event.kind)).toEqual([AgentEventKinds.SessionNotFound, AgentEventKinds.SessionBusy]);
    expect(steer).toHaveBeenCalledOnce();
    expect(followUp).toHaveBeenCalledOnce();
    expect(fixture.store.loadConversation("session-busy")).toEqual([]);
  });

  test("session list snapshots expose the authoritative active request", async () => {
    const pendingLoop = createPendingLoop();
    const fixture = createManagerFixture({ loopFactory: () => pendingLoop.loop });
    const events: AgentDomainEvent[] = [];

    await fixture.manager.createSession({ sessionId: "session-active-list" });
    const run = fixture.manager.submitMessage({
      sessionId: "session-active-list",
      requestId: "request-active-list",
      input: "wait for approval",
    });
    await pendingLoop.started;
    await fixture.manager.emitSessionListSnapshot({ onEvent: collect(events) });

    expect(fixture.manager.listSessions()).toEqual([
      expect.objectContaining({
        sessionId: "session-active-list",
        status: "running",
        activeRequestId: "request-active-list",
      }),
    ]);
    expect(events).toEqual([
      expect.objectContaining({
        kind: AgentEventKinds.SessionListSnapshot,
        data: {
          sessions: [
            expect.objectContaining({
              sessionId: "session-active-list",
              activeRequestId: "request-active-list",
            }),
          ],
        },
      }),
    ]);

    await expect(fixture.manager.cancelActiveRun({ sessionId: "session-active-list" })).resolves.toBe(true);
    await run;
  });
});
