import { describe, expect, test, vi } from "vitest";
import { AgentCancellationError } from "../../../Source/AgentSystem/Core/AgentCancellation.js";
import { AgentEventKinds, type AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import type { AgentLoopRunner } from "../../../Source/AgentSystem/Loop/AgentLoopRunner.js";
import { createDeferred, waitForAbort } from "../Support/AsyncTestFixtures.js";
import { AgentSessionStatuses } from "../../../Source/AgentSystem/Session/AgentSession.js";
import { AgentInteractionInputRuntime } from "../../../Source/AgentSystem/Interaction/AgentInteractionInputRuntime.js";
import { AgentSessionRunCoordinatorShuttingDownError } from "../../../Source/AgentSystem/Session/AgentSessionRunCoordinator.js";
import { AgentSessionCommandConflictError } from "../../../Source/AgentSystem/Session/AgentSessionCommand.js";
import {
  completedRun,
  createCoordinatorFixture,
  createPendingLoop,
  requestInteractionInput,
} from "./SessionRunCoordinatorTestFixtures.js";

describe("Session run coordinator behavior", () => {
  test("persists a successful turn, records memory, and releases the session", async () => {
    const fixture = createCoordinatorFixture({
      loop: {
        run: async (request) => {
          expect(request.emitRunStarted).toBe(false);
          const terminalEvents: AgentDomainEvent[] = [
            {
              eventId: "event-assistant-completed",
              kind: AgentEventKinds.AssistantMessageCreated,
              context: { requestId: request.requestId },
              data: {
                messageId: "assistant-message-completed",
                kind: "final_answer",
                content: "Inspection complete.",
                terminal: true,
              },
            },
            {
              eventId: "event-run-completed",
              kind: AgentEventKinds.RunCompleted,
              context: { requestId: request.requestId },
              data: {},
            },
          ];
          await request.commitTerminalEvents?.(terminalEvents);
          return completedRun(request.requestId);
        },
      },
    });
    const events: AgentDomainEvent[] = [];
    const terminalOrder: string[] = [];
    const persistTurnCommit = fixture.store.persistTurnCommit.bind(fixture.store);
    vi.spyOn(fixture.store, "persistTurnCommit").mockImplementation((...args) => {
      terminalOrder.push("commit");
      return persistTurnCommit(...args);
    });

    await fixture.coordinator.runTurn(fixture.session, {
      requestId: "request-success",
      input: "Inspect the release workflow",
      onEvent: (event) => {
        events.push(event);
        if (event.kind === AgentEventKinds.AssistantMessageCreated || event.kind === AgentEventKinds.RunCompleted) {
          terminalOrder.push(`publish:${event.kind}`);
        }
      },
    });

    expect(fixture.session).toMatchObject({
      status: AgentSessionStatuses.Idle,
      activeRequest: undefined,
    });
    expect(fixture.store.loadConversation(fixture.session.id).map((entry) => entry.kind)).toEqual([
      "user.message",
      "assistant.decision",
    ]);
    expect(fixture.store.loadStepTraces(fixture.session.id)).toEqual([
      expect.objectContaining({ requestId: "request-success", traces: [expect.objectContaining({ kind: "answer" })] }),
    ]);
    expect(fixture.store.loadRunSnapshots(fixture.session.id)).toEqual([
      expect.objectContaining({ requestId: "request-success", status: "completed" }),
    ]);
    expect(fixture.memoryRepository.listCompletedEpisodes()).toEqual([
      expect.objectContaining({ requestId: "request-success", rawUserText: "Inspect the release workflow" }),
    ]);
    expect(events.map((event) => event.kind)).toEqual([
      AgentEventKinds.RunStarted,
      AgentEventKinds.AssistantMessageCreated,
      AgentEventKinds.RunCompleted,
    ]);
    const persistedEvents = fixture.store.loadRunEvents(fixture.session.id);
    expect(persistedEvents.map((event) => event.kind)).toEqual([
      AgentEventKinds.RunStarted,
      AgentEventKinds.AssistantMessageCreated,
      AgentEventKinds.RunCompleted,
    ]);
    expect(persistedEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventId: "event-assistant-completed",
          kind: AgentEventKinds.AssistantMessageCreated,
        }),
        expect.objectContaining({ eventId: "event-run-completed", kind: AgentEventKinds.RunCompleted }),
      ]),
    );
    fixture.store.persistRunEvents(fixture.session.id, persistedEvents);
    expect(fixture.store.loadRunEvents(fixture.session.id)).toHaveLength(3);
    expect(terminalOrder).toEqual([
      "commit",
      `publish:${AgentEventKinds.AssistantMessageCreated}`,
      `publish:${AgentEventKinds.RunCompleted}`,
    ]);
  });

  test("inherits the last compatible tool availability snapshot across session turns", async () => {
    const loadedToolRequests: Array<"all" | string[] | undefined> = [];
    const loop: AgentLoopRunner = {
      preparationFingerprint: "runtime-tools-v1",
      run: async (request) => {
        loadedToolRequests.push(request.loadedToolNames);
        return {
          ...completedRun(request.requestId),
          loadedToolNames: ["ToolSearchTool", "ShellCommandTool"],
        };
      },
    };
    const fixture = createCoordinatorFixture({ loop });

    await fixture.coordinator.runTurn(fixture.session, {
      requestId: "request-tools-first",
      input: "Run a diagnostic command",
    });
    await fixture.coordinator.runTurn(fixture.session, {
      requestId: "request-tools-second",
      input: "Run another diagnostic command",
    });

    expect(loadedToolRequests).toEqual([undefined, ["ToolSearchTool", "ShellCommandTool"]]);
    expect(fixture.session.metadata?.toolAvailability).toMatchObject({
      runtimeFingerprint: "runtime-tools-v1",
      loadedToolNames: ["ToolSearchTool", "ShellCommandTool"],
    });
  });

  test("does not erase a warm tool snapshot when a direct turn returns no loaded tools", async () => {
    const loop: AgentLoopRunner = {
      preparationFingerprint: "runtime-tools-v1",
      run: async (request) => ({
        ...completedRun(request.requestId),
        loadedToolNames: [],
      }),
    };
    const fixture = createCoordinatorFixture({ loop });
    fixture.session.metadata = {
      toolAvailability: {
        runtimeFingerprint: "runtime-tools-v1",
        loadedToolNames: ["ToolSearchTool", "WeatherTool"],
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    };

    await fixture.coordinator.runTurn(fixture.session, {
      requestId: "request-direct",
      input: "Thanks",
    });

    expect(fixture.session.metadata.toolAvailability?.loadedToolNames).toEqual(["ToolSearchTool", "WeatherTool"]);
  });

  test("keeps a committed run completed when terminal publication fails", async () => {
    const fixture = createCoordinatorFixture({
      loop: {
        run: async (request) => {
          await request.commitTerminalEvents?.([
            {
              eventId: "event-completed-before-publish-failure",
              kind: AgentEventKinds.RunCompleted,
              context: { requestId: request.requestId },
              data: {},
            },
          ]);
          return completedRun(request.requestId);
        },
      },
    });

    await expect(
      fixture.coordinator.runTurn(fixture.session, {
        requestId: "request-publish-failure",
        input: "Complete despite a disconnected client",
        onEvent: (event) => {
          if (event.kind === AgentEventKinds.RunCompleted) throw new Error("client disconnected");
        },
      }),
    ).resolves.toBeUndefined();

    expect(fixture.store.loadRunSnapshots(fixture.session.id)).toEqual([
      expect.objectContaining({ requestId: "request-publish-failure", status: "completed" }),
    ]);
    expect(fixture.store.loadRunEvents(fixture.session.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventId: "event-completed-before-publish-failure",
          kind: AgentEventKinds.RunCompleted,
        }),
      ]),
    );
    expect(fixture.session.status).toBe(AgentSessionStatuses.Idle);
  });

  test("replays a matching durable command without executing the loop twice", async () => {
    const run = vi.fn(async (request: Parameters<AgentLoopRunner["run"]>[0]) => {
      await request.commitTerminalEvents?.([
        {
          eventId: "event-idempotent-completed",
          kind: AgentEventKinds.RunCompleted,
          context: { requestId: request.requestId },
          data: {},
        },
      ]);
      return completedRun(request.requestId);
    });
    const fixture = createCoordinatorFixture({ loop: { run } });
    const replayedEvents: AgentDomainEvent[] = [];

    await fixture.coordinator.runTurn(fixture.session, {
      requestId: "request-idempotent",
      input: "Inspect once",
    });
    await fixture.coordinator.runTurn(fixture.session, {
      requestId: "request-idempotent",
      input: "Inspect once",
      onEvent: (event) => {
        replayedEvents.push(event);
      },
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(fixture.store.loadConversation(fixture.session.id)).toHaveLength(2);
    expect(replayedEvents.map((event) => event.kind)).toEqual([
      AgentEventKinds.RunStarted,
      AgentEventKinds.RunCompleted,
    ]);
    expect(replayedEvents.map((event) => event.eventId)).toEqual(
      fixture.store.loadRunEventsForRequest(fixture.session.id, "request-idempotent").map((event) => event.eventId),
    );
  });

  test("rejects request id reuse with a different canonical payload", async () => {
    const run = vi.fn(async (request: Parameters<AgentLoopRunner["run"]>[0]) => completedRun(request.requestId));
    const fixture = createCoordinatorFixture({ loop: { run } });

    await fixture.coordinator.runTurn(fixture.session, {
      requestId: "request-conflict",
      input: "Original request",
    });

    await expect(
      fixture.coordinator.runTurn(fixture.session, {
        requestId: "request-conflict",
        input: "Different request",
      }),
    ).rejects.toBeInstanceOf(AgentSessionCommandConflictError);
    expect(run).toHaveBeenCalledTimes(1);
    expect(fixture.store.loadConversation(fixture.session.id)).toHaveLength(2);
  });

  test("does not expose uncommitted terminal entries when terminal persistence fails", async () => {
    const fixture = createCoordinatorFixture({
      loop: { run: async (request) => completedRun(request.requestId) },
    });
    vi.spyOn(fixture.store, "persistTurnCommit").mockImplementation(() => {
      throw new Error("terminal storage unavailable");
    });

    await expect(
      fixture.coordinator.runTurn(fixture.session, {
        requestId: "request-terminal-commit-failure",
        input: "Do not leak the answer",
      }),
    ).rejects.toThrow("terminal storage unavailable");

    expect(fixture.session.status).toBe(AgentSessionStatuses.Running);
    expect(fixture.session.conversation.map((entry) => entry.kind)).toEqual(["user.message"]);
    expect(fixture.store.loadConversation(fixture.session.id).map((entry) => entry.kind)).toEqual(["user.message"]);
    expect(fixture.store.loadRunSnapshots(fixture.session.id)).toEqual([
      expect.objectContaining({ requestId: "request-terminal-commit-failure", status: "running" }),
    ]);
  });

  test("quiesces active runs before shutdown completes and rejects future runs", async () => {
    const pending = createPendingLoop();
    const fixture = createCoordinatorFixture({ loop: pending.loop });
    const run = fixture.coordinator.runTurn(fixture.session, {
      requestId: "request-shutdown",
      input: "Wait for shutdown",
    });
    await pending.started;

    const shutdown = fixture.coordinator.shutdown();
    await Promise.all([run, shutdown]);

    expect(fixture.store.loadRunSnapshots(fixture.session.id)).toEqual([
      expect.objectContaining({ requestId: "request-shutdown", status: "cancelled" }),
    ]);
    expect(fixture.store.loadCommand(fixture.session.id, "request-shutdown")).toEqual(
      expect.objectContaining({ state: "cancelled" }),
    );
    await expect(
      fixture.coordinator.runTurn(fixture.session, {
        requestId: "request-after-shutdown",
        input: "Must be rejected",
      }),
    ).rejects.toBeInstanceOf(AgentSessionRunCoordinatorShuttingDownError);
  });

  test("stores failure state and emits a contextual failure event", async () => {
    const fixture = createCoordinatorFixture({
      loop: {
        run: async () => {
          throw new Error("model transport failed");
        },
      },
    });
    const events: AgentDomainEvent[] = [];

    await fixture.coordinator.runTurn(fixture.session, {
      requestId: "request-failed",
      input: "Inspect the workspace",
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(fixture.session.status).toBe(AgentSessionStatuses.Idle);
    expect(fixture.store.loadRunSnapshots(fixture.session.id)).toEqual([
      expect.objectContaining({
        requestId: "request-failed",
        status: "failed",
        errorMessage: "model transport failed",
      }),
    ]);
    expect(events).toEqual([
      expect.objectContaining({
        kind: AgentEventKinds.RunStarted,
        context: expect.objectContaining({ sessionId: fixture.session.id, requestId: "request-failed" }),
      }),
      expect.objectContaining({
        kind: AgentEventKinds.RunFailed,
        context: expect.objectContaining({ sessionId: fixture.session.id, requestId: "request-failed" }),
      }),
    ]);
    const emittedFailure = events.find((event) => event.kind === AgentEventKinds.RunFailed);
    const persistedEvents = fixture.store.loadRunEvents(fixture.session.id);
    expect(persistedEvents.map((event) => event.kind)).toEqual([AgentEventKinds.RunStarted, AgentEventKinds.RunFailed]);
    expect(persistedEvents).toContainEqual(
      expect.objectContaining({ eventId: emittedFailure?.eventId, kind: AgentEventKinds.RunFailed }),
    );
  });

  test("commits cancellation snapshot and event before publishing the terminal state", async () => {
    const fixture = createCoordinatorFixture({
      loop: {
        run: async () => {
          throw new AgentCancellationError();
        },
      },
    });
    const events: AgentDomainEvent[] = [];

    await fixture.coordinator.runTurn(fixture.session, {
      requestId: "request-cancelled-directly",
      input: "Cancel this turn",
      onEvent: (event) => {
        events.push(event);
      },
    });

    const emittedCancellation = events.find((event) => event.kind === AgentEventKinds.RunCancelled);
    expect(fixture.store.loadRunSnapshots(fixture.session.id)).toEqual([
      expect.objectContaining({ requestId: "request-cancelled-directly", status: "cancelled" }),
    ]);
    const persistedEvents = fixture.store.loadRunEvents(fixture.session.id);
    expect(persistedEvents.map((event) => event.kind)).toEqual([
      AgentEventKinds.RunStarted,
      AgentEventKinds.RunCancelled,
    ]);
    expect(persistedEvents).toContainEqual(
      expect.objectContaining({ eventId: emittedCancellation?.eventId, kind: AgentEventKinds.RunCancelled }),
    );
  });

  test.each([
    {
      name: "successful completion",
      run: (requestId: string) => completedRun(requestId),
    },
    {
      name: "model failure",
      run: () => {
        throw new Error("model transport failed");
      },
    },
  ])("cleans pending interaction input after $name", async ({ run }) => {
    const interactionInput = new AgentInteractionInputRuntime();
    let interaction: Promise<unknown> | undefined;
    const fixture = createCoordinatorFixture({
      interactionInput,
      loop: {
        run: async (request) => {
          interaction = requestInteractionInput(interactionInput, request.requestId);
          return run(request.requestId);
        },
      },
    });

    await fixture.coordinator.runTurn(fixture.session, {
      requestId: "request-owned-interaction",
      input: "Inspect the workspace",
    });

    expect(interactionInput.listPending()).toEqual([]);
    await expect(interaction).resolves.toMatchObject({ action: "cancel" });
    expect(fixture.session.status).toBe(AgentSessionStatuses.Idle);
  });

  test("cleans pending interaction input when an active turn is cancelled", async () => {
    const interactionInput = new AgentInteractionInputRuntime();
    const started = createDeferred<void>();
    let interaction: Promise<unknown> | undefined;
    const fixture = createCoordinatorFixture({
      interactionInput,
      loop: {
        run: async (request) => {
          interaction = requestInteractionInput(interactionInput, request.requestId);
          started.resolve();
          await waitForAbort(request.signal);
          throw request.signal?.reason instanceof Error ? request.signal.reason : new AgentCancellationError();
        },
      },
    });
    const run = fixture.coordinator.runTurn(fixture.session, {
      requestId: "request-cancelled-interaction",
      input: "Wait for input",
    });
    await started.promise;

    await fixture.coordinator.discardActiveRun(fixture.session);
    await run;

    expect(interactionInput.listPending()).toEqual([]);
    await expect(interaction).resolves.toMatchObject({ action: "cancel" });
    expect(fixture.session.status).toBe(AgentSessionStatuses.Idle);
  });

  test("releases the session when a run-owned resource cleanup fails", async () => {
    const interactionInput = new AgentInteractionInputRuntime();
    const cancelByRequestId = vi
      .spyOn(interactionInput, "cancelByRequestId")
      .mockRejectedValue(new Error("interaction cleanup failed"));
    const fixture = createCoordinatorFixture({
      interactionInput,
      loop: { run: async (request) => completedRun(request.requestId) },
    });

    await fixture.coordinator.runTurn(fixture.session, {
      requestId: "request-cleanup-failure",
      input: "Inspect the workspace",
    });

    expect(cancelByRequestId).toHaveBeenCalledWith("request-cleanup-failure");
    expect(fixture.coordinator.hasActiveRun(fixture.session.id)).toBe(false);
    expect(fixture.session.status).toBe(AgentSessionStatuses.Idle);
  });

  test("releases declarative run resources with complete request ownership context", async () => {
    const release = vi.fn(async () => undefined);
    const fixture = createCoordinatorFixture({
      loop: { run: async (request) => completedRun(request.requestId) },
      runResources: [{ id: "test-resource", release }],
    });

    await fixture.coordinator.runTurn(fixture.session, {
      requestId: "request-resource-context",
      input: "Inspect the workspace",
    });

    expect(release).toHaveBeenCalledWith({
      sessionId: fixture.session.id,
      requestId: "request-resource-context",
    });
  });
});
