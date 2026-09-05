import { describe, expect, test, vi } from "vitest";
import { AgentEventKinds, type AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentMemoryService } from "../../../Source/AgentSystem/Memory/AgentMemoryService.js";
import { InMemoryAgentMemorySourceRepository } from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import {
  InMemorySessionRepository,
  SqliteSessionRepository,
} from "../../../Source/AgentSystem/Session/AgentSqliteSessionRepository.js";
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
import { AgentSessionQueuedMessageConflictError } from "../../../Source/AgentSystem/Session/AgentSessionActiveRunController.js";
import { createAgentSessionMessageCommand } from "../../../Source/AgentSystem/Session/AgentSessionCommand.js";
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
  test("does not expose internal-owned sessions through the user session catalog", async () => {
    const fixture = createManagerFixture({
      managedSessionIds: new Set(["legacy-child"]),
    });
    fixture.store.open("metadata-child", {
      type: "child_run",
      childRunId: "child-1",
      parentSessionId: "parent-1",
      parentRequestId: "request-1",
      agentName: "reviewer",
    });
    fixture.store.open("legacy-child");
    fixture.store.open("scheduled-run", { type: "scheduled_run", taskId: "task-1" });
    fixture.store.open("user-session");

    expect(fixture.manager.listSessions().map((session) => session.sessionId)).toEqual(["user-session"]);
  });

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

  test("delivers a scheduled result into its owner conversation exactly once", async () => {
    const fixture = createManagerFixture();
    const events: AgentDomainEvent[] = [];
    await fixture.manager.createSession({ sessionId: "scheduled-owner" });

    const request = {
      deliveryId: "scheduled-run-1",
      taskId: "task-1",
      sessionId: "scheduled-owner",
      content: "It is time to start work.",
      createdAt: "2026-08-05T00:02:00.000Z",
      onEvent: collect(events),
    };
    await expect(fixture.manager.deliverScheduledTaskResult(request)).resolves.toBe("delivered");
    await expect(fixture.manager.deliverScheduledTaskResult(request)).resolves.toBe("delivered");
    await expect(fixture.manager.deliverScheduledTaskResult({ ...request, sessionId: "missing-owner" })).resolves.toBe(
      "missing",
    );

    expect(fixture.store.loadConversation("scheduled-owner")).toEqual([
      expect.objectContaining({
        id: "scheduled-run-1:assistant",
        requestId: "scheduled-run-1",
        kind: "assistant.decision",
        xml: expect.stringContaining("It is time to start work."),
        metadata: {
          scheduledTask: { taskId: "task-1", runId: "scheduled-run-1" },
        },
      }),
    ]);
    expect(events.filter((event) => event.kind === AgentEventKinds.AssistantMessageCreated)).toHaveLength(1);
  });

  test("shares the same idempotent boundary for proactive Resident delivery", async () => {
    const fixture = createManagerFixture();
    const events: AgentDomainEvent[] = [];
    await fixture.manager.createSession({ sessionId: "resident-owner" });
    const request = {
      deliveryId: "resident-idle-work-1",
      sessionId: "resident-owner",
      content: "世界出现了新的变化。",
      createdAt: "2026-08-05T00:03:00.000Z",
      metadata: { proactive: { sourceId: "world.resident.idle", deliveryId: "resident-idle-work-1" } },
      onEvent: collect(events),
    };
    await expect(fixture.manager.deliverProactiveMessage(request)).resolves.toBe("delivered");
    await expect(fixture.manager.deliverProactiveMessage(request)).resolves.toBe("delivered");
    expect(fixture.store.loadConversation("resident-owner")).toEqual([
      expect.objectContaining({
        requestId: "resident-idle-work-1",
        metadata: request.metadata,
        xml: expect.stringContaining("世界出现了新的变化。"),
      }),
    ]);
    expect(events.filter((event) => event.kind === AgentEventKinds.AssistantMessageCreated)).toHaveLength(1);
  });

  test("re-enters an owner session for detached completion and remains idempotent", async () => {
    const fixture = createManagerFixture();
    const events: AgentDomainEvent[] = [];
    await fixture.manager.createSession({ sessionId: "background-owner" });

    const request = {
      sessionId: "background-owner",
      requestId: "background-child-1-rev-1",
      input: JSON.stringify({ taskId: "background-child-1", status: "completed", result: "finished" }),
      approvalMode: "agent" as const,
      modelProviderId: "provider-background",
      metadata: { backgroundTask: { taskId: "background-child-1", runId: "background-child-1" } },
      onEvent: collect(events),
    };

    await expect(fixture.manager.wakeFromBackgroundTask(request)).resolves.toBe("accepted");
    await expect(fixture.manager.wakeFromBackgroundTask(request)).resolves.toBe("accepted");

    const conversation = fixture.store.loadConversation("background-owner");
    expect(conversation.filter((entry) => entry.kind === "user.message")).toHaveLength(1);
    expect(conversation[0]).toEqual(
      expect.objectContaining({
        requestId: request.requestId,
        metadata: request.metadata,
        content: request.input,
      }),
    );
    // A replayed request re-emits its durable lifecycle to the caller, but it
    // does not append a second conversation turn.
    expect(events.filter((event) => event.kind === AgentEventKinds.RunStarted)).toHaveLength(2);
  });

  test("reclaims an interrupted completion wake after restart without duplicating its user entry", async () => {
    const repository = new InMemorySessionRepository();
    const seedStore = new AgentSessionStore({ repository });
    const opened = seedStore.open("background-recovery-owner");
    const request = {
      sessionId: "background-recovery-owner",
      requestId: "background-child-recovery-rev-1",
      input: JSON.stringify({ taskId: "background-child-recovery", status: "completed", result: "finished" }),
      approvalMode: "agent" as const,
      modelProviderId: "provider-background",
      metadata: { backgroundTask: { taskId: "background-child-recovery", runId: "background-child-recovery" } },
    };
    const startedAt = "2026-08-05T00:04:00.000Z";
    const entry = userEntry(request.requestId, request.input);
    const runningSession = {
      ...opened.session,
      status: "running" as const,
      updatedAt: startedAt,
      activeRequest: { requestId: request.requestId, input: request.input, startedAt },
      conversation: [entry],
    };
    const command = createAgentSessionMessageCommand({
      requestId: request.requestId,
      modelProviderId: request.modelProviderId,
      text: request.input,
      approvalMode: request.approvalMode,
      createdAt: startedAt,
    });
    seedStore.persistRunStart(
      runningSession,
      request.requestId,
      entry,
      {
        sessionId: request.sessionId,
        requestId: request.requestId,
        input: request.input,
        status: "running",
        startedAt,
        updatedAt: startedAt,
      },
      runEvent(request.sessionId, request.requestId, 1),
      command,
    );

    const fixture = createManagerFixture({
      repository,
      loopFactory: () => ({ run: async () => completedRun(request.requestId) }),
    });
    await expect(fixture.manager.wakeFromBackgroundTask(request)).resolves.toBe("accepted");
    await vi.waitFor(() => {
      expect(fixture.store.loadConversation(request.sessionId)).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: "assistant.decision", requestId: request.requestId })]),
      );
    });

    const conversation = fixture.store.loadConversation(request.sessionId);
    expect(conversation.filter((item) => item.kind === "user.message")).toHaveLength(1);
    expect(conversation.filter((item) => item.kind === "assistant.decision")).toHaveLength(1);
  });

  test("resolves the durable fork boundary and only disposes internal scheduled forks", async () => {
    const fixture = createManagerFixture();
    await fixture.manager.createSession({ sessionId: "scheduled-owner" });
    fixture.store.persistEntries("scheduled-owner", [
      userEntry("owner-request", "Set a reminder."),
      assistantEntry("owner-answer", "<response><answer>Scheduled.</answer></response>"),
    ]);
    fixture.store.open("scheduled-execution", { type: "scheduled_run", taskId: "task-1" });
    fixture.store.open("user-session");

    await expect(fixture.manager.resolveScheduledTaskForkBoundary("scheduled-owner")).resolves.toBe("owner-answer");
    await expect(fixture.manager.disposeScheduledTaskSession("scheduled-execution")).resolves.toBeUndefined();
    await expect(fixture.manager.disposeScheduledTaskSession("user-session")).rejects.toThrow(
      "Refusing to dispose non-scheduled session",
    );

    expect(fixture.store.get("scheduled-execution")).toEqual({ kind: "missing", sessionId: "scheduled-execution" });
    expect(fixture.manager.listSessions().map((session) => session.sessionId)).toEqual(
      expect.arrayContaining(["scheduled-owner", "user-session"]),
    );
  });

  test("atomically creates a missing session with its first message", async () => {
    const fixture = createManagerFixture();
    const events: AgentDomainEvent[] = [];

    await fixture.manager.submitMessage({
      approvalMode: "agent",
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
      approvalMode: "agent",
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
      approvalMode: "agent",
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
        approvalMode: "agent",
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
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: AgentEventKinds.SessionTruncated,
          data: expect.objectContaining({ removedEntries: 2 }),
        }),
      ]),
    );
  });

  test("routes submitMessage missing and busy paths through stable events", async () => {
    const pendingLoop = createPendingLoop();
    const piSessions = new AgentPiActiveSessionRegistry();
    const fixture = createManagerFixture({ loopFactory: () => pendingLoop.loop, piSessions });
    const events: AgentDomainEvent[] = [];
    const steer = vi.fn(async () => undefined);
    const followUp = vi.fn(async () => undefined);

    const missingOutcome = await fixture.manager.submitMessage({
      approvalMode: "agent",
      sessionId: "missing-session",
      input: "hello",
      onEvent: collect(events),
    });
    await fixture.manager.createSession({ sessionId: "session-busy" });
    const run = fixture.manager.submitMessage({
      approvalMode: "agent",
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
    const busyOutcome = await fixture.manager.submitMessage({
      approvalMode: "agent",
      sessionId: "session-busy",
      requestId: "request-busy",
      input: "second turn",
      onEvent: collect(events),
    });
    const steerOutcome = await fixture.manager.submitMessage({
      approvalMode: "agent",
      sessionId: "session-busy",
      requestId: "request-steer",
      input: "change direction",
      queueMode: AgentSessionMessageQueueModes.Steer,
    });
    const followUpOutcome = await fixture.manager.submitMessage({
      approvalMode: "agent",
      sessionId: "session-busy",
      requestId: "request-follow-up",
      input: "continue afterwards",
      queueMode: AgentSessionMessageQueueModes.FollowUp,
    });
    const duplicateOutcome = fixture.manager.submitMessage({
      approvalMode: "agent",
      sessionId: "session-busy",
      requestId: "request-follow-up",
      input: "different follow-up",
      queueMode: AgentSessionMessageQueueModes.FollowUp,
    });
    expect(missingOutcome.kind).toBe("missing");
    expect(busyOutcome.kind).toBe("busy");
    expect(steerOutcome.kind).toBe("queued");
    expect(followUpOutcome.kind).toBe("queued");
    expect(fixture.store.loadConversation("session-busy").map((entry) => entry.requestId)).toEqual([
      "request-running",
      "request-steer",
      "request-follow-up",
    ]);
    await expect(duplicateOutcome).rejects.toBeInstanceOf(AgentSessionQueuedMessageConflictError);
    unregister();
    await expect(fixture.manager.cancelActiveRun({ sessionId: "session-busy" })).resolves.toBe(true);
    await run;

    expect(events.map((event) => event.kind)).toEqual([AgentEventKinds.SessionNotFound, AgentEventKinds.SessionBusy]);
    expect(steer).toHaveBeenCalledOnce();
    expect(followUp).toHaveBeenCalledOnce();
    await vi.waitFor(() =>
      expect(fixture.store.loadConversation("session-busy").map((entry) => entry.requestId)).toEqual([
        "request-running",
        "request-steer",
        "request-follow-up",
      ]),
    );
  });

  test("accepts cancellation immediately while a non-cooperative run finishes in the background", async () => {
    const started = createDeferred<void>();
    const release = createDeferred<void>();
    const events: AgentDomainEvent[] = [];
    const fixture = createManagerFixture({
      runControl: { settlementTimeoutMs: 10 },
      loopFactory: () => ({
        run: async (request) => {
          started.resolve();
          await waitForAbort(request.signal);
          await release.promise;
          throw request.signal?.reason instanceof Error ? request.signal.reason : new AgentCancellationError();
        },
      }),
    });
    await fixture.manager.createSession({ sessionId: "session-delayed-cancel" });
    const run = fixture.manager.submitMessage({
      approvalMode: "agent",
      sessionId: "session-delayed-cancel",
      requestId: "request-delayed-cancel",
      input: "long run",
      onEvent: collect(events),
    });
    await started.promise;

    await expect(
      fixture.manager.cancelActiveRun({ sessionId: "session-delayed-cancel", onEvent: collect(events) }),
    ).resolves.toBe(true);
    expect(fixture.store.loadRunSnapshots("session-delayed-cancel")).toEqual([
      expect.objectContaining({
        requestId: "request-delayed-cancel",
        status: "cancelled",
        endedAt: expect.any(String),
      }),
    ]);
    await vi.waitFor(() =>
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: AgentEventKinds.RunCancellationProgress,
            data: expect.objectContaining({ stage: "settlement_delayed" }),
          }),
        ]),
      ),
    );

    release.resolve();
    await run;
    await vi.waitFor(() =>
      expect(fixture.store.loadConversation("session-delayed-cancel")).toEqual([
        expect.objectContaining({ requestId: "request-delayed-cancel", kind: "user.message", content: "long run" }),
      ]),
    );
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ kind: AgentEventKinds.RunCancelled })]));
    expect(events).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: AgentEventKinds.SessionTruncated })]),
    );
  });

  test("settles cancellation after its deadline and preserves history when the run eventually settles", async () => {
    const started = createDeferred<void>();
    const release = createDeferred<void>();
    const events: AgentDomainEvent[] = [];
    const fixture = createManagerFixture({
      runControl: { settlementTimeoutMs: 10 },
      loopFactory: () => ({
        run: async (request) => {
          started.resolve();
          await waitForAbort(request.signal);
          await release.promise;
          throw request.signal?.reason instanceof Error ? request.signal.reason : new AgentCancellationError();
        },
      }),
    });
    await fixture.manager.createSession({ sessionId: "session-background-cancel" });
    const run = fixture.manager.submitMessage({
      approvalMode: "agent",
      sessionId: "session-background-cancel",
      requestId: "request-background-cancel",
      input: "Keep running until cancellation.",
      onEvent: collect(events),
    });
    await started.promise;

    await expect(
      fixture.manager.settleActiveRunCancellation({
        sessionId: "session-background-cancel",
        onEvent: collect(events),
      }),
    ).resolves.toBe(true);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: AgentEventKinds.RunCancellationProgress,
          data: expect.objectContaining({ stage: "settlement_delayed" }),
        }),
      ]),
    );

    release.resolve();
    await run;
    await vi.waitFor(() =>
      expect(fixture.store.loadConversation("session-background-cancel")).toEqual([
        expect.objectContaining({
          requestId: "request-background-cancel",
          kind: "user.message",
          content: "Keep running until cancellation.",
        }),
      ]),
    );
  });

  test("accepts cancellation without waiting for the active run to settle", async () => {
    const started = createDeferred<void>();
    const release = createDeferred<void>();
    const events: AgentDomainEvent[] = [];
    const fixture = createManagerFixture({
      runControl: { settlementTimeoutMs: 10 },
      loopFactory: () => ({
        run: async (request) => {
          started.resolve();
          await waitForAbort(request.signal);
          await release.promise;
          throw request.signal?.reason instanceof Error ? request.signal.reason : new AgentCancellationError();
        },
      }),
    });
    await fixture.manager.createSession({ sessionId: "session-request-cancel" });
    const run = fixture.manager.submitMessage({
      approvalMode: "agent",
      sessionId: "session-request-cancel",
      requestId: "request-request-cancel",
      input: "Keep running until cancellation.",
      onEvent: collect(events),
    });
    await started.promise;

    await expect(
      fixture.manager.requestActiveRunCancellation({
        sessionId: "session-request-cancel",
        onEvent: collect(events),
      }),
    ).resolves.toBe(true);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: AgentEventKinds.RunCancellationProgress,
          data: expect.objectContaining({ stage: "started" }),
        }),
      ]),
    );

    release.resolve();
    await run;
  });

  test("session list snapshots expose the authoritative active request", async () => {
    const pendingLoop = createPendingLoop();
    const fixture = createManagerFixture({ loopFactory: () => pendingLoop.loop });
    const events: AgentDomainEvent[] = [];

    await fixture.manager.createSession({ sessionId: "session-active-list" });
    const run = fixture.manager.submitMessage({
      approvalMode: "agent",
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
