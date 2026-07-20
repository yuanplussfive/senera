import { describe, expect, test, vi } from "vitest";
import { AgentEventKinds, type AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentMemoryService } from "../../../Source/AgentSystem/Memory/AgentMemoryService.js";
import { InMemoryAgentMemorySourceRepository } from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import { SqliteSessionRepository } from "../../../Source/AgentSystem/Session/AgentSqliteSessionRepository.js";
import { AgentSessionStore } from "../../../Source/AgentSystem/Session/AgentSessionStore.js";
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
import { AgentSessionRunSettlementTimeoutError } from "../../../Source/AgentSystem/Session/AgentSessionRunControlPolicy.js";
import { createDeferred, waitForAbort } from "../Support/AsyncTestFixtures.js";
import {
  assistantEntry,
  collect,
  completedRun,
  createManagerFixture,
  createPendingLoop,
  runEvent,
  turnPreparation,
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
    expect(fixture.store.get("session-cleanup-failure")).toEqual({ kind: "missing", sessionId: "session-cleanup-failure" });
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

  test("regenerates by truncating the old branch before submitting the replacement turn", async () => {
    const observedConversationRequestIds: string[][] = [];
    const observedPreparations: unknown[] = [];
    const storeRef: { current?: AgentSessionStore } = {};
    const rewind = vi.fn(async () => true);
    const reset = vi.fn(async () => true);
    const fixture = createManagerFixture({
      piSessionMutations: { rewind, reset },
      loopFactory: () => ({
        run: async (request) => {
          observedConversationRequestIds.push(
            storeRef.current!.loadConversation("session-regenerate").map((entry) => entry.requestId),
          );
          observedPreparations.push(request.preparation);
          return completedRun("request-replacement");
        },
      }),
    });
    storeRef.current = fixture.store;
    await fixture.manager.createSession({ sessionId: "session-regenerate" });
    fixture.store.persistEntries("session-regenerate", [
      userEntry("request-a", "A"),
      assistantEntry("request-a", "Answer A"),
      userEntry("request-b", "B"),
      assistantEntry("request-b", "Answer B"),
    ]);
    fixture.store.persistTurnPreparation("session-regenerate", "request-b", {
      ...turnPreparation("B"),
      piBranchBoundaryId: "boundary-b",
    });
    const events: AgentDomainEvent[] = [];

    await fixture.manager.regenerateFromRequest({
      sessionId: "session-regenerate",
      fromRequestId: "request-b",
      requestId: "request-replacement",
      modelProviderId: "provider-replacement",
      input: "B",
      onEvent: collect(events),
    });

    expect(observedConversationRequestIds).toEqual([["request-a", "request-a", "request-replacement"]]);
    expect(observedPreparations).toEqual([
      expect.objectContaining({ route: expect.objectContaining({ objective: "B" }) }),
    ]);
    expect(rewind).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-regenerate",
        entryId: "boundary-b",
      }),
    );
    expect(reset).not.toHaveBeenCalled();
    expect(fixture.store.loadConversation("session-regenerate").map((entry) => entry.requestId)).toEqual([
      "request-a",
      "request-a",
      "request-replacement",
      "request-replacement",
    ]);
    expect(events[0]).toEqual(
      expect.objectContaining({
        kind: AgentEventKinds.SessionTruncated,
        data: expect.objectContaining({ replacementRequestId: "request-replacement" }),
      }),
    );
  });

  test("waits for an active turn to settle before truncating and starting its replacement", async () => {
    const activeStarted = createDeferred<void>();
    const cancellationObserved = createDeferred<void>();
    const allowCancellationToSettle = createDeferred<void>();
    const piAbortStarted = createDeferred<void>();
    const allowPiSessionToBecomeIdle = createDeferred<void>();
    const replacementStarted = vi.fn();
    const piSessions = new AgentPiActiveSessionRegistry();
    let invocation = 0;
    const fixture = createManagerFixture({
      piSessions,
      loopFactory: () => ({
        run: async (request) => {
          invocation += 1;
          if (invocation === 1) {
            await request.onPreparation?.(turnPreparation("B"));
            await request.onPiBranchBoundary?.("boundary-active");
            activeStarted.resolve();
            await waitForAbort(request.signal);
            cancellationObserved.resolve();
            await allowCancellationToSettle.promise;
            throw request.signal?.reason instanceof Error ? request.signal.reason : new AgentCancellationError();
          }

          replacementStarted();
          return completedRun(request.requestId);
        },
      }),
    });
    await fixture.manager.createSession({ sessionId: "session-active-regenerate" });
    const activeRun = fixture.manager.submitMessage({
      sessionId: "session-active-regenerate",
      requestId: "request-active",
      input: "B",
    });
    await activeStarted.promise;
    const unregisterPiSession = piSessions.register({
      sessionId: "session-active-regenerate",
      requestId: "request-active",
      step: 1,
      session: {
        abort: async () => {
          piAbortStarted.resolve();
          await allowPiSessionToBecomeIdle.promise;
        },
      } as unknown as AgentPiSession,
    });

    const regeneration = fixture.manager.regenerateFromRequest({
      sessionId: "session-active-regenerate",
      fromRequestId: "request-active",
      requestId: "request-replacement",
      input: "B",
    });
    await cancellationObserved.promise;

    expect(replacementStarted).not.toHaveBeenCalled();
    expect(fixture.store.loadConversation("session-active-regenerate").map((entry) => entry.requestId)).toEqual([
      "request-active",
    ]);

    allowCancellationToSettle.resolve();
    await Promise.all([activeRun, piAbortStarted.promise]);

    expect(replacementStarted).not.toHaveBeenCalled();
    expect(fixture.store.loadConversation("session-active-regenerate").map((entry) => entry.requestId)).toEqual([
      "request-active",
    ]);

    allowPiSessionToBecomeIdle.resolve();
    await regeneration;
    unregisterPiSession();

    expect(replacementStarted).toHaveBeenCalledOnce();
    expect(fixture.store.loadConversation("session-active-regenerate").map((entry) => entry.requestId)).toEqual([
      "request-replacement",
      "request-replacement",
    ]);
  });

  test("keeps the old branch isolated when active-run settlement times out", async () => {
    const activeStarted = createDeferred<void>();
    const allowRunToSettle = createDeferred<void>();
    const allowPiSessionToBecomeIdle = createDeferred<void>();
    const piSessions = new AgentPiActiveSessionRegistry();
    const replacementStarted = vi.fn();
    let invocation = 0;
    const fixture = createManagerFixture({
      piSessions,
      runControl: { settlementTimeoutMs: 10 },
      loopFactory: () => ({
        run: async (request) => {
          invocation += 1;
          if (invocation === 1) {
            activeStarted.resolve();
            await waitForAbort(request.signal);
            await allowRunToSettle.promise;
            throw request.signal?.reason instanceof Error ? request.signal.reason : new AgentCancellationError();
          }
          replacementStarted();
          return completedRun(request.requestId);
        },
      }),
    });
    await fixture.manager.createSession({ sessionId: "session-settlement-timeout" });
    const activeRun = fixture.manager.submitMessage({
      sessionId: "session-settlement-timeout",
      requestId: "request-active",
      input: "B",
    });
    await activeStarted.promise;
    const unregister = piSessions.register({
      sessionId: "session-settlement-timeout",
      requestId: "request-active",
      step: 1,
      session: {
        abort: () => allowPiSessionToBecomeIdle.promise,
      } as unknown as AgentPiSession,
    });

    await expect(
      fixture.manager.regenerateFromRequest({
        sessionId: "session-settlement-timeout",
        fromRequestId: "request-active",
        requestId: "request-replacement",
        input: "B",
      }),
    ).rejects.toBeInstanceOf(AgentSessionRunSettlementTimeoutError);

    expect(replacementStarted).not.toHaveBeenCalled();
    expect(fixture.store.loadConversation("session-settlement-timeout").map((entry) => entry.requestId)).toEqual([
      "request-active",
    ]);
    expect(fixture.store.loadRunSnapshots("session-settlement-timeout")).toEqual([
      expect.objectContaining({ requestId: "request-active", status: "running" }),
    ]);
    expect(fixture.store.get("session-settlement-timeout")).toEqual(
      expect.objectContaining({
        kind: "found",
        session: expect.objectContaining({
          metadata: expect.objectContaining({
            lifecycle: expect.objectContaining({
              cancellation: expect.objectContaining({
                state: "cancellation_pending",
                requestId: "request-active",
              }),
            }),
          }),
        }),
      }),
    );

    allowRunToSettle.resolve();
    allowPiSessionToBecomeIdle.resolve();
    await activeRun;
    unregister();
    await vi.waitFor(() => {
      expect(fixture.store.loadRunSnapshots("session-settlement-timeout")).toEqual([
        expect.objectContaining({ requestId: "request-active", status: "cancelled" }),
      ]);
    });
    expect(fixture.store.get("session-settlement-timeout")).toEqual(
      expect.objectContaining({
        kind: "found",
        session: expect.not.objectContaining({
          metadata: expect.objectContaining({ lifecycle: expect.objectContaining({ cancellation: expect.anything() }) }),
        }),
      }),
    );
  });

  test("starts only the latest regeneration while concurrent commands wait for the same active turn", async () => {
    const activeStarted = createDeferred<void>();
    const cancellationObserved = createDeferred<void>();
    const allowCancellationToSettle = createDeferred<void>();
    const replacementRequestIds: string[] = [];
    let invocation = 0;
    const fixture = createManagerFixture({
      loopFactory: () => ({
        run: async (request) => {
          invocation += 1;
          if (invocation === 1) {
            await request.onPreparation?.(turnPreparation("B"));
            await request.onPiBranchBoundary?.("boundary-concurrent");
            activeStarted.resolve();
            await waitForAbort(request.signal);
            cancellationObserved.resolve();
            await allowCancellationToSettle.promise;
            throw request.signal?.reason instanceof Error ? request.signal.reason : new AgentCancellationError();
          }
          replacementRequestIds.push(request.requestId);
          return completedRun(request.requestId);
        },
      }),
    });
    await fixture.manager.createSession({ sessionId: "session-concurrent-regenerate" });
    const activeRun = fixture.manager.submitMessage({
      sessionId: "session-concurrent-regenerate",
      requestId: "request-active",
      input: "B",
    });
    await activeStarted.promise;
    const firstEvents: AgentDomainEvent[] = [];
    const secondEvents: AgentDomainEvent[] = [];
    const first = fixture.manager.regenerateFromRequest({
      sessionId: "session-concurrent-regenerate",
      fromRequestId: "request-active",
      requestId: "request-replacement-1",
      input: "B",
      onEvent: collect(firstEvents),
    });
    await cancellationObserved.promise;
    const second = fixture.manager.regenerateFromRequest({
      sessionId: "session-concurrent-regenerate",
      fromRequestId: "request-active",
      requestId: "request-replacement-2",
      input: "B",
      onEvent: collect(secondEvents),
    });

    allowCancellationToSettle.resolve();
    await Promise.all([activeRun, first, second]);

    expect(replacementRequestIds).toEqual(["request-replacement-2"]);
    expect(firstEvents).toContainEqual(
      expect.objectContaining({
        kind: AgentEventKinds.RunCancelled,
        context: expect.objectContaining({ requestId: "request-replacement-1" }),
      }),
    );
    expect(secondEvents).not.toContainEqual(expect.objectContaining({ kind: AgentEventKinds.RunCancellationProgress }));
    expect(secondEvents).toContainEqual(expect.objectContaining({ kind: AgentEventKinds.SessionTruncated }));
    expect(fixture.store.loadConversation("session-concurrent-regenerate").map((entry) => entry.requestId)).toEqual([
      "request-replacement-2",
      "request-replacement-2",
    ]);
  });

  test("replaces the current regeneration lineage after its source request was removed", async () => {
    const firstReplacementStarted = createDeferred<void>();
    const observedPreparations: unknown[] = [];
    let invocation = 0;
    const fixture = createManagerFixture({
      loopFactory: () => ({
        run: async (request) => {
          invocation += 1;
          if (invocation === 1) {
            await request.onPreparation?.(turnPreparation("B"));
            await request.onPiBranchBoundary?.("boundary-lineage");
            return completedRun(request.requestId);
          }
          if (invocation === 2) {
            firstReplacementStarted.resolve();
            await waitForAbort(request.signal);
            throw request.signal?.reason instanceof Error ? request.signal.reason : new AgentCancellationError();
          }
          observedPreparations.push(request.preparation);
          return completedRun(request.requestId);
        },
      }),
    });
    await fixture.manager.createSession({ sessionId: "session-regeneration-lineage" });
    await fixture.manager.submitMessage({
      sessionId: "session-regeneration-lineage",
      requestId: "request-source",
      input: "B",
    });
    const first = fixture.manager.regenerateFromRequest({
      sessionId: "session-regeneration-lineage",
      fromRequestId: "request-source",
      requestId: "request-lineage-1",
      input: "B",
    });
    await firstReplacementStarted.promise;

    const second = fixture.manager.regenerateFromRequest({
      sessionId: "session-regeneration-lineage",
      fromRequestId: "request-source",
      requestId: "request-lineage-2",
      input: "B",
    });
    await Promise.all([first, second]);

    expect(observedPreparations).toEqual([
      expect.objectContaining({
        piBranchBoundaryId: "boundary-lineage",
        route: expect.objectContaining({ objective: "B" }),
      }),
    ]);
    expect(fixture.store.loadConversation("session-regeneration-lineage").map((entry) => entry.requestId)).toEqual([
      "request-lineage-2",
      "request-lineage-2",
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
