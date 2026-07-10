import { describe, expect, test } from "vitest";
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
import { InMemorySessionRepository } from "../../../Source/AgentSystem/Session/AgentSqliteSessionRepository.js";
import { AgentSessionStatuses } from "../../../Source/AgentSystem/Session/AgentSession.js";
import { AgentSessionRunCoordinator } from "../../../Source/AgentSystem/Session/AgentSessionRunCoordinator.js";
import { AgentSessionStore } from "../../../Source/AgentSystem/Session/AgentSessionStore.js";

describe("Session run coordinator behavior", () => {
  test("persists a successful turn, records memory, and releases the session", async () => {
    const fixture = createCoordinatorFixture({
      loop: {
        run: async (request) => {
          await request.onEvent?.({
            kind: AgentEventKinds.RunStarted,
            context: { requestId: request.requestId },
            data: { input: request.input },
          });
          return completedRun(request.requestId);
        },
      },
    });
    const events: AgentDomainEvent[] = [];

    await fixture.coordinator.runTurn(fixture.session, {
      requestId: "request-success",
      input: "Inspect the release workflow",
      onEvent: (event) => {
        events.push(event);
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
    expect(events).toEqual([
      expect.objectContaining({
        kind: AgentEventKinds.RunStarted,
        context: expect.objectContaining({ sessionId: fixture.session.id }),
      }),
    ]);
  });

  test("stores failure state and emits a contextual failure event", async () => {
    const fixture = createCoordinatorFixture({
      loop: { run: async () => { throw new Error("model transport failed"); } },
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
        kind: AgentEventKinds.RunFailed,
        context: expect.objectContaining({ sessionId: fixture.session.id, requestId: "request-failed" }),
      }),
    ]);
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
    await expect(fixture.coordinator.cancelActiveRun({
      sessionId: fixture.session.id,
      onEvent: (event) => {
        events.push(event);
      },
    })).resolves.toBe(true);
    await run;

    expect(await fixture.coordinator.cancelActiveRun({ sessionId: fixture.session.id })).toBe(false);
    expect(fixture.session.status).toBe(AgentSessionStatuses.Idle);
    expect(fixture.store.loadConversation(fixture.session.id)).toEqual([]);
    expect(fixture.store.loadRunSnapshots(fixture.session.id)).toEqual([]);
    expect(events.map((event) => event.kind)).toEqual(expect.arrayContaining([
      AgentEventKinds.RunCancelled,
      AgentEventKinds.SessionTruncated,
    ]));
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

    await expect(fixture.coordinator.steerActiveRun({
      session: fixture.session,
      requestId: "request-steer",
      input: "Check the package manifest first",
      onEvent: (event) => {
        events.push(event);
      },
    })).resolves.toBe(true);
    await expect(fixture.coordinator.steerActiveRun({
      session: fixture.session,
      requestId: "request-follow-up",
      input: "Then summarize the release scripts",
      queueMode: "follow_up",
    })).resolves.toBe(true);

    expect(pi.steered).toEqual(["Check the package manifest first"]);
    expect(pi.followUps).toEqual(["Then summarize the release scripts"]);
    expect(fixture.store.loadConversation(fixture.session.id).map((entry) => entry.requestId)).toEqual([
      "request-active",
      "request-steer",
      "request-follow-up",
    ]);
    expect(events).toEqual([
      expect.objectContaining({ kind: AgentEventKinds.PiTrace }),
    ]);

    unregister();
    await fixture.coordinator.cancelActiveRun({ sessionId: fixture.session.id });
    await run;
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
    loopFactory: () => options.loop,
  });
  return { coordinator, memoryRepository, session, store };
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
    conversationEntries: [projector.projectOpenAiTranscript(requestId, [{
      role: "assistant",
      content: "Inspection complete.",
    }], "2026-01-01T00:01:00.000Z")],
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
          const rejectCancellation = () => reject(
            request.signal?.reason instanceof Error
              ? request.signal.reason
              : new AgentCancellationError(),
          );
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
