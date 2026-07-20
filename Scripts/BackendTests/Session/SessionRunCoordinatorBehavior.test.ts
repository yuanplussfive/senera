import { describe, expect, test, vi } from "vitest";
import { AgentCancellationError } from "../../../Source/AgentSystem/Core/AgentCancellation.js";
import { AgentConversationPolicy } from "../../../Source/AgentSystem/Conversation/AgentConversationPolicy.js";
import { AgentConversationProjector } from "../../../Source/AgentSystem/Conversation/AgentConversationProjector.js";
import { AgentEventKinds, type AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import type { AgentLoopRunner } from "../../../Source/AgentSystem/Loop/AgentLoopRunner.js";
import { AgentMemoryService } from "../../../Source/AgentSystem/Memory/AgentMemoryService.js";
import { InMemoryAgentMemorySourceRepository } from "../../../Source/AgentSystem/Memory/AgentMemorySourceRepository.js";
import { AgentPiActiveSessionRegistry } from "../../../Source/AgentSystem/Pi/AgentPiActiveSessionRegistry.js";
import type { AgentPiSession } from "../../../Source/AgentSystem/Pi/AgentPiSubstrate.js";
import type { AgentCompletedRunResult } from "../../../Source/AgentSystem/Runtime/AgentExecutionProjector.js";
import { createDeferred, waitForAbort } from "../Support/AsyncTestFixtures.js";
import { InMemorySessionRepository } from "../../../Source/AgentSystem/Session/AgentSqliteSessionRepository.js";
import { AgentSessionStatuses } from "../../../Source/AgentSystem/Session/AgentSession.js";
import { AgentSessionRunCoordinator } from "../../../Source/AgentSystem/Session/AgentSessionRunCoordinator.js";
import { AgentSessionStore } from "../../../Source/AgentSystem/Session/AgentSessionStore.js";
import { AgentSessionMessageQueueModes } from "../../../Source/AgentSystem/Session/AgentSessionMessageQueueMode.js";
import { AgentDefaults } from "../../../Source/AgentSystem/AgentDefaults.js";
import { AgentInteractionInputRuntime } from "../../../Source/AgentSystem/Interaction/AgentInteractionInputRuntime.js";
import { createAgentRequestCancellationResource } from "../../../Source/AgentSystem/Session/AgentSessionRunResource.js";

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
      "openai.transcript",
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

  test("cancels and truncates an active turn exactly once", async () => {
    const pendingLoop = createPendingLoop();
    const fixture = createCoordinatorFixture({ loop: pendingLoop.loop });
    const events: AgentDomainEvent[] = [];
    const run = fixture.coordinator.runTurn(fixture.session, {
      requestId: "request-cancelled",
      input: "Long-running inspection",
      onEvent: (event) => {
        events.push(event);
      },
    });
    await pendingLoop.started;

    expect(fixture.coordinator.assertAvailable(fixture.session).kind).toBe("busy");
    await expect(
      fixture.coordinator.cancelActiveRun({
        sessionId: fixture.session.id,
        onEvent: (event) => {
          events.push(event);
        },
      }),
    ).resolves.toBe(true);
    await run;

    expect(await fixture.coordinator.cancelActiveRun({ sessionId: fixture.session.id })).toBe(false);
    expect(fixture.session.status).toBe(AgentSessionStatuses.Idle);
    expect(fixture.store.loadConversation(fixture.session.id)).toEqual([]);
    expect(fixture.store.loadRunSnapshots(fixture.session.id)).toEqual([]);
    expect(events.map((event) => event.kind)).toEqual(
      expect.arrayContaining([
        AgentEventKinds.RunCancellationProgress,
        AgentEventKinds.RunCancelled,
        AgentEventKinds.SessionTruncated,
      ]),
    );
    const cancellationStages = events
      .filter((event) => event.kind === AgentEventKinds.RunCancellationProgress)
      .map((event) => event.data);
    expect(cancellationStages[0]).toEqual(expect.objectContaining({ stage: "started" }));
    expect(cancellationStages.at(-1)).toEqual(
      expect.objectContaining({ stage: "completed", durationMs: expect.any(Number) }),
    );
    expect(cancellationStages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "component_completed",
          component: "agent_loop",
          durationMs: expect.any(Number),
        }),
        expect.objectContaining({
          stage: "component_completed",
          component: "pi_session",
          durationMs: expect.any(Number),
        }),
      ]),
    );
  });

  test("routes steer and follow-up input to the active Pi session", async () => {
    const pendingLoop = createPendingLoop();
    const piSessions = new AgentPiActiveSessionRegistry();
    const fixture = createCoordinatorFixture({ loop: pendingLoop.loop, piSessions });
    const pi = new RecordingPiQueueSession();
    const run = fixture.coordinator.runTurn(fixture.session, {
      requestId: "request-active",
      input: "Inspect the workspace",
    });
    await pendingLoop.started;
    const unregister = piSessions.register({
      sessionId: fixture.session.id,
      requestId: "request-active",
      step: 2,
      session: pi as unknown as AgentPiSession,
    });
    const events: AgentDomainEvent[] = [];

    await expect(
      fixture.coordinator.enqueueActiveRunMessage({
        session: fixture.session,
        requestId: "request-steer",
        input: "Check the package manifest first",
        queueMode: AgentSessionMessageQueueModes.Steer,
        onEvent: (event) => {
          events.push(event);
        },
      }),
    ).resolves.toBe(true);
    await expect(
      fixture.coordinator.enqueueActiveRunMessage({
        session: fixture.session,
        requestId: "request-follow-up",
        input: "Then summarize the release scripts",
        queueMode: AgentSessionMessageQueueModes.FollowUp,
      }),
    ).resolves.toBe(true);

    expect(pi.steered).toEqual(["Check the package manifest first"]);
    expect(pi.followUps).toEqual(["Then summarize the release scripts"]);
    expect(fixture.store.loadConversation(fixture.session.id).map((entry) => entry.requestId)).toEqual([
      "request-active",
      "request-steer",
      "request-follow-up",
    ]);
    expect(events).toEqual([expect.objectContaining({ kind: AgentEventKinds.PiTrace })]);

    unregister();
    await fixture.coordinator.cancelActiveRun({ sessionId: fixture.session.id });
    await run;
  });

  test("does not persist queued input when Pi rejects it", async () => {
    const pendingLoop = createPendingLoop();
    const piSessions = new AgentPiActiveSessionRegistry();
    const fixture = createCoordinatorFixture({ loop: pendingLoop.loop, piSessions });
    const run = fixture.coordinator.runTurn(fixture.session, {
      requestId: "request-active",
      input: "Inspect the workspace",
    });
    await pendingLoop.started;
    const unregister = piSessions.register({
      sessionId: fixture.session.id,
      requestId: "request-active",
      step: 2,
      session: {
        steer: async () => {
          throw new Error("Pi queue is unavailable");
        },
      } as unknown as AgentPiSession,
    });

    await expect(
      fixture.coordinator.enqueueActiveRunMessage({
        session: fixture.session,
        requestId: "request-rejected",
        input: "Change direction",
        queueMode: AgentSessionMessageQueueModes.Steer,
      }),
    ).rejects.toThrow("Pi queue is unavailable");
    expect(fixture.store.loadConversation(fixture.session.id).map((entry) => entry.requestId)).toEqual([
      "request-active",
    ]);

    unregister();
    await fixture.coordinator.cancelActiveRun({ sessionId: fixture.session.id });
    await run;
  });

  test("waits for the run even when Pi abort rejects first", async () => {
    const runStarted = createDeferred<void>();
    const allowRunToSettle = createDeferred<void>();
    const piSessions = new AgentPiActiveSessionRegistry();
    const fixture = createCoordinatorFixture({
      piSessions,
      loop: {
        run: async (request) => {
          runStarted.resolve();
          await waitForAbort(request.signal);
          await allowRunToSettle.promise;
          throw request.signal?.reason instanceof Error ? request.signal.reason : new AgentCancellationError();
        },
      },
    });
    const run = fixture.coordinator.runTurn(fixture.session, {
      requestId: "request-active",
      input: "Inspect the workspace",
    });
    await runStarted.promise;
    const unregister = piSessions.register({
      sessionId: fixture.session.id,
      requestId: "request-active",
      step: 2,
      session: {
        abort: async () => {
          throw new Error("Pi abort failed");
        },
      } as unknown as AgentPiSession,
    });
    let stopSettled = false;

    const stop = fixture.coordinator.discardActiveRun(fixture.session).finally(() => {
      stopSettled = true;
    });
    await Promise.resolve();
    expect(stopSettled).toBe(false);

    allowRunToSettle.resolve();
    await expect(stop).rejects.toThrow("Pi abort failed");
    await run;
    unregister();
  });

  test("repairs stale running metadata and orphaned snapshots", () => {
    const fixture = createCoordinatorFixture({ loop: { run: async () => completedRun("unused") } });
    fixture.session.status = AgentSessionStatuses.Running;
    fixture.session.activeRequest = {
      requestId: "request-orphaned",
      input: "Interrupted request",
      startedAt: "2026-01-01T00:00:00.000Z",
    };
    fixture.store.persistMetadata(fixture.session);
    fixture.store.persistRunSnapshot({
      sessionId: fixture.session.id,
      requestId: "request-orphaned",
      input: "Interrupted request",
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(fixture.coordinator.assertAvailable(fixture.session).kind).toBe("available");
    fixture.coordinator.cleanupOrphanedRunningSnapshots();

    expect(fixture.session).toMatchObject({ status: AgentSessionStatuses.Idle, activeRequest: undefined });
    expect(fixture.store.loadRunSnapshots(fixture.session.id)).toEqual([
      expect.objectContaining({ status: "failed", errorMessage: expect.stringContaining("后端重启") }),
    ]);
  });
});

function createCoordinatorFixture(options: {
  loop: AgentLoopRunner;
  piSessions?: AgentPiActiveSessionRegistry;
  interactionInput?: AgentInteractionInputRuntime;
  runResources?: ConstructorParameters<typeof AgentSessionRunCoordinator>[0]["runResources"];
}) {
  const sessionRepository = new InMemorySessionRepository();
  const store = new AgentSessionStore({ repository: sessionRepository });
  const session = store.open("session-test").session;
  const memoryRepository = new InMemoryAgentMemorySourceRepository();
  const coordinator = new AgentSessionRunCoordinator({
    store,
    conversationPolicy: new AgentConversationPolicy(),
    conversationProjector: new AgentConversationProjector(),
    memory: new AgentMemoryService({ sourceRepository: memoryRepository }),
    piSessions: options.piSessions,
    runResources: [
      ...(options.runResources ?? []),
      ...(options.interactionInput
        ? [createAgentRequestCancellationResource("interaction_input", options.interactionInput)]
        : []),
    ],
    runControl: {
      settlementTimeoutMs: AgentDefaults.AgentLoop.RunSettlementTimeoutMs,
    },
    loopFactory: () => options.loop,
  });
  return { coordinator, memoryRepository, session, store };
}

function requestInteractionInput(runtime: AgentInteractionInputRuntime, requestId: string): Promise<unknown> {
  return runtime.request({
    owner: {
      sessionId: "session-test",
      requestId,
      step: 1,
      toolCallId: "tool-call-interaction",
      toolName: "InteractiveTool",
    },
    mode: "form",
    message: "Choose a value",
    schema: {
      type: "object",
      properties: { value: { type: "string" } },
    },
  });
}

function completedRun(requestId: string): AgentCompletedRunResult {
  const projector = new AgentConversationProjector();
  return {
    terminal: { kind: "FinalAnswer", content: "Inspection complete." },
    decisionXml: "<agent_result><final_answer>Inspection complete.</final_answer></agent_result>",
    modelProvider: {
      id: "test-model",
      kind: "OpenAICompatible",
      endpoint: "ChatCompletions",
      baseUrl: "https://model.example/v1",
      model: "test-model",
    },
    usage: { source: "local_estimate", inputTokens: 10, outputTokens: 4 },
    conversationEntries: [
      projector.projectOpenAiTranscript(
        requestId,
        [
          {
            role: "assistant",
            content: "Inspection complete.",
          },
        ],
        "2026-01-01T00:01:00.000Z",
      ),
    ],
    stepTraces: [{ step: 1, seq: 0, kind: "answer", status: "done" }],
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
        return new Promise<AgentCompletedRunResult>((_resolve, reject) => {
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

class RecordingPiQueueSession {
  readonly steered: string[] = [];
  readonly followUps: string[] = [];

  async steer(input: string): Promise<void> {
    this.steered.push(input);
  }

  async followUp(input: string): Promise<void> {
    this.followUps.push(input);
  }
}
