import { afterEach, describe, expect, test, vi } from "vitest";
import path from "node:path";
import { AgentCancellationError } from "../../../Source/AgentSystem/Core/AgentCancellation.js";
import { AgentEventKinds, type AgentEventSink } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentDelegationService } from "../../../Source/AgentSystem/Orchestration/AgentDelegationService.js";
import { projectAgentChildRunView } from "../../../Source/AgentSystem/Orchestration/AgentOrchestrationHostTools.js";
import { AgentOrchestrationEventRelay } from "../../../Source/AgentSystem/Orchestration/AgentOrchestrationEventRelay.js";
import { AgentSqliteChildRunRepository } from "../../../Source/AgentSystem/Orchestration/AgentSqliteChildRunRepository.js";
import {
  AgentChildRunStatuses,
  AgentChildWorkspaceAccessModes,
  AgentChildRunCheckpointSources,
} from "../../../Source/AgentSystem/Orchestration/AgentChildRunTypes.js";
import type {
  AgentRunDispatchRequest,
  AgentRunDispatchResult,
} from "../../../Source/AgentSystem/Orchestration/AgentRunDispatchPort.js";
import { AgentExecutionApprovalModes } from "../../../Source/AgentSystem/Safety/AgentExecutionApprovalMode.js";
import { AgentSessionRunDispatcher } from "../../../Source/AgentSystem/Session/AgentSessionRunDispatcher.js";
import { AgentSkillScanner } from "../../../Source/AgentSystem/Skills/AgentSkillScanner.js";
import { cleanupDelegationTestRoots, modelConfig, openDelegationTestDatabase } from "./AgentDelegationTestSupport.js";

afterEach(() => cleanupDelegationTestRoots());

describe("agent lifecycle", () => {
  test("spawns asynchronously with the package-declared default role and host-owned workspace policy", async () => {
    const harness = createHarness();
    const run = await harness.service.spawn({ task: "Inspect and improve the assigned scope." }, parentContext());

    expect(run).toMatchObject({
      agentName: "delegate",
      status: AgentChildRunStatuses.Queued,
      executionContract: { workspaceAccess: AgentChildWorkspaceAccessModes.ReadWrite },
    });
    expect(projectAgentChildRunView(run, run.id)).toEqual({
      runId: run.id,
      state: "queued",
      agent: "delegate",
    });
    await harness.dispatcher.waitForDispatches(1);
    expect(harness.dispatcher.requests[0]).toMatchObject({
      sessionId: run.childSessionId,
      contextMode: "fresh",
      approvalMode: AgentExecutionApprovalModes.Agent,
    });

    harness.dispatcher.complete(run.childSessionId, "Default child completed.");
    const completed = await harness.service.wait(run.id, "parent-session");
    expect(completed).toMatchObject({
      status: AgentChildRunStatuses.Completed,
      finalAnswer: "Default child completed.",
    });
    expect(projectAgentChildRunView(completed, run.id)).toEqual({
      runId: run.id,
      state: "completed",
      agent: "delegate",
      result: { content: "Default child completed." },
    });
    harness.close();
  });

  test("waits for whichever child settles first and never cancels work on wait timeout", async () => {
    const harness = createHarness();
    const first = await harness.service.spawn({ task: "First independent task." }, parentContext());
    const second = await harness.service.spawn({ task: "Second independent task." }, parentContext());
    await harness.dispatcher.waitForDispatches(2);

    await expect(harness.service.waitAny([first.id, second.id], "parent-session", 0)).resolves.toMatchObject({
      timedOut: true,
    });
    expect(harness.dispatcher.cancel).not.toHaveBeenCalled();

    const waiting = harness.service.waitAny([first.id, second.id], "parent-session", 10_000);
    harness.dispatcher.complete(second.childSessionId, "Second completed first.");
    const settled = await waiting;
    expect(settled.timedOut).toBe(false);
    expect(settled.runs[1]).toMatchObject({
      status: AgentChildRunStatuses.Completed,
      finalAnswer: "Second completed first.",
    });
    expect(settled.runs[0]?.status).toBe(AgentChildRunStatuses.Running);

    await expect(harness.service.stop(first.id, "parent-session")).resolves.toMatchObject({
      status: AgentChildRunStatuses.Cancelling,
    });
    harness.dispatcher.complete(first.childSessionId, "First child stopped after cancellation.");
    await expect(harness.service.wait(first.id, "parent-session")).resolves.toMatchObject({
      status: AgentChildRunStatuses.Cancelled,
    });
    harness.close();
  });

  test("projects live progress without exposing the persisted snapshot body", async () => {
    const harness = createHarness();
    const run = await harness.service.spawn({ task: "Inspect one subsystem." }, parentContext());
    await harness.dispatcher.waitForDispatches(1);

    harness.repository.recordSnapshot(
      run.id,
      {
        version: 1,
        capturedAt: "2026-07-11T00:00:01.000Z",
        lastActivityAt: "2026-07-11T00:00:01.000Z",
        lastModelOutputAt: "2026-07-11T00:00:01.000Z",
        modelOutputCharacters: 240,
        assistantTurns: 2,
        toolCalls: { planned: 4, started: 3, completed: 2, failed: 0 },
        activeTools: ["WorkspaceRead", "WorkspaceGrep"],
        artifactUris: ["senera://artifact/evidence-1", "senera://artifact/evidence-2"],
        deadline: {
          softDeadlineAt: "2026-07-11T00:10:00.000Z",
          grantedExtensionMs: 0,
        },
      },
      {
        version: 1,
        capturedAt: "2026-07-11T00:00:01.000Z",
        source: AgentChildRunCheckpointSources.ModelStream,
        content: "Collected evidence.",
        complete: false,
      },
    );

    const projected = projectAgentChildRunView(harness.service.get(run.id, "parent-session"), run.id);
    expect(projected).toMatchObject({
      state: "running",
      progress: {
        phase: "tool_execution",
        lastActivityAt: "2026-07-11T00:00:01.000Z",
        activeTools: ["WorkspaceRead", "WorkspaceGrep"],
        toolCalls: { planned: 4, started: 3, completed: 2, failed: 0 },
        checkpointAvailable: true,
        artifactCount: 2,
      },
    });
    expect(projected).not.toHaveProperty("snapshot");
    expect(projected).not.toHaveProperty("progress.checkpoint");
    harness.close();
  });

  test("wakes when a child requests supervisor input without exposing snapshot cursors", async () => {
    const harness = createHarness();
    const run = await harness.service.spawn({ task: "Inspect one subsystem." }, parentContext());
    await harness.dispatcher.waitForDispatches(1);
    expect(harness.service.get(run.id, "parent-session")?.status).toBe(AgentChildRunStatuses.Running);

    const waiting = harness.service.waitAny([run.id], "parent-session", 10_000);
    await harness.service.contactSupervisor(
      run.childSessionId,
      run.childRequestId,
      { reason: "need_decision", message: "Choose the narrow review scope?" },
      harness.dispatcher.requests[0]?.onEvent,
    );

    const ready = await waiting;
    expect(ready).toMatchObject({
      timedOut: false,
      runs: [
        expect.objectContaining({
          id: run.id,
          status: AgentChildRunStatuses.AwaitingSupervisor,
        }),
      ],
    });
    harness.dispatcher.complete(run.childSessionId, "Waiting for the supervisor decision.");
    await harness.service.wait(run.id, "parent-session");
    harness.close();
  });

  test("routes queued input through follow-up and immediate redirection through Pi steering", async () => {
    const harness = createHarness();
    const context = parentContext();
    const run = await harness.service.spawn({ task: "Collect evidence." }, context);
    await harness.dispatcher.waitForDispatches(1);

    const followUp = await harness.service.sendInput(
      run.id,
      context.parentSessionId,
      "After the current task, compare the two alternatives.",
      false,
      context,
    );
    const steering = await harness.service.sendInput(
      run.id,
      context.parentSessionId,
      "Stop the broad scan and focus on the failing contract.",
      true,
      context,
    );

    expect(harness.dispatcher.followUp).toHaveBeenCalledWith(
      run.childSessionId,
      "After the current task, compare the two alternatives.",
      undefined,
    );
    expect(harness.dispatcher.steer).toHaveBeenCalledWith(
      run.childSessionId,
      "Stop the broad scan and focus on the failing contract.",
      undefined,
    );
    expect(followUp?.message.kind).toBe("follow_up");
    expect(steering?.message.kind).toBe("steering");

    harness.dispatcher.complete(run.childSessionId, "Redirected task completed.");
    await harness.service.wait(run.id, context.parentSessionId);
    harness.close();
  });

  test("treats input at the child turn boundary as a settled lifecycle result", async () => {
    const harness = createHarness();
    const context = parentContext();
    const run = await harness.service.spawn({ task: "Finish the evidence scan." }, context);
    await harness.dispatcher.waitForDispatches(1);

    harness.dispatcher.complete(run.childSessionId, "Evidence scan completed.");
    await expect(harness.service.wait(run.id, context.parentSessionId)).resolves.toMatchObject({
      status: AgentChildRunStatuses.Completed,
    });

    await expect(
      harness.service.sendInput(run.id, context.parentSessionId, "Add one more comparison.", true, context),
    ).resolves.toBeUndefined();
    expect(harness.dispatcher.steer).not.toHaveBeenCalled();
    harness.close();
  });

  test("returns a terminal result when the dispatcher observes a settled child boundary", async () => {
    const harness = createHarness();
    const context = parentContext();
    const run = await harness.service.spawn({ task: "Collect one fact." }, context);
    await harness.dispatcher.waitForDispatches(1);
    harness.dispatcher.steer.mockResolvedValueOnce(false);

    await expect(
      harness.service.sendInput(run.id, context.parentSessionId, "Stop and summarize.", true, context),
    ).resolves.toBeUndefined();
    expect(harness.service.get(run.id, context.parentSessionId)?.messages).toHaveLength(0);

    harness.dispatcher.complete(run.childSessionId, "Fact collected.");
    await harness.service.wait(run.id, context.parentSessionId);
    harness.close();
  });

  test("acknowledges recursive cancellation without waiting for active child settlement", async () => {
    const harness = createHarness();
    const root = await harness.service.spawn({ task: "Coordinate one nested task." }, parentContext());
    const child = await harness.service.spawn(
      { task: "Nested task." },
      parentContext(root.childSessionId, root.childRequestId),
    );
    await harness.dispatcher.waitForDispatches(2);

    const current = await harness.service.stop(root.id, "parent-session");

    expect(current?.status).toBe(AgentChildRunStatuses.Cancelling);
    expect(harness.dispatcher.requestCancellation.mock.calls.map(([sessionId]) => sessionId)).toEqual([
      child.childSessionId,
      root.childSessionId,
    ]);
    expect(harness.dispatcher.cancel).not.toHaveBeenCalled();
    expect(harness.service.get(root.id, "parent-session")?.status).toBe(AgentChildRunStatuses.Cancelling);
    expect(harness.service.get(child.id, root.childSessionId)?.status).toBe(AgentChildRunStatuses.Cancelling);

    harness.dispatcher.complete(child.childSessionId, "Nested child stopped.");
    harness.dispatcher.complete(root.childSessionId, "Root child stopped.");
    await expect(harness.service.wait(child.id, root.childSessionId)).resolves.toMatchObject({
      status: AgentChildRunStatuses.Cancelled,
    });
    await expect(harness.service.wait(root.id, "parent-session")).resolves.toMatchObject({
      status: AgentChildRunStatuses.Cancelled,
    });
    harness.close();
  });

  test("keeps a child stopping until the submitted session turn really settles", async () => {
    const database = openDelegationTestDatabase();
    let settleSubmission!: () => void;
    const submission = new Promise<void>((resolve) => {
      settleSubmission = resolve;
    });
    const sessions = {
      forkSession: vi.fn(async () => undefined),
      submitMessage: vi.fn(async (request: { onEvent?: AgentEventSink }) => {
        await request.onEvent?.({
          kind: AgentEventKinds.ModelDelta,
          context: { requestId: "child-request", step: 1 },
          data: { text: "Checkpoint retained while the child runtime is stopping." },
        });
        return submission;
      }),
      requestActiveRunCancellation: vi.fn(async () => true),
      settleActiveRunCancellation: vi.fn(async () => true),
      requestActiveRunFinalAnswer: vi.fn(async () => true),
      steerActiveRun: vi.fn(async () => true),
      followUpActiveRun: vi.fn(async () => true),
      interruptActiveRun: vi.fn(async () => true),
    };
    const service = new AgentDelegationService({
      workspaceRoot: process.cwd(),
      configuration: () => ({ config: modelConfig() }),
      repository: new AgentSqliteChildRunRepository(database),
      dispatcher: new AgentSessionRunDispatcher(sessions),
      events: new AgentOrchestrationEventRelay(),
    });

    try {
      const run = await service.spawn({ task: "Remain active until cancelled." }, parentContext());
      await vi.waitFor(() => expect(sessions.submitMessage).toHaveBeenCalledOnce());

      await expect(service.stop(run.id, "parent-session")).resolves.toMatchObject({
        id: run.id,
        status: AgentChildRunStatuses.Cancelling,
      });
      expect(service.get(run.id, "parent-session")?.status).toBe(AgentChildRunStatuses.Cancelling);

      settleSubmission();
      await expect(service.wait(run.id, "parent-session")).resolves.toMatchObject({
        id: run.id,
        status: AgentChildRunStatuses.Cancelled,
        finalAnswer: "Checkpoint retained while the child runtime is stopping.",
      });
      expect(sessions.requestActiveRunCancellation).toHaveBeenCalled();
      expect(sessions.settleActiveRunCancellation).not.toHaveBeenCalled();
    } finally {
      await service.shutdown();
      database.close();
    }
  });
});

function parentContext(parentSessionId = "parent-session", parentRequestId = "parent-request") {
  return {
    parentSessionId,
    parentRequestId,
    parentModelProviderId: "main",
    approvalMode: AgentExecutionApprovalModes.Agent,
    authorizedToolNames: [],
    registry: testRegistry(),
  };
}

function testRegistry() {
  const skills = new Map(
    new AgentSkillScanner()
      .scanRoot(path.resolve("System", "Extensions", "agent-delegation", "skills"))
      .map((skill) => [skill.name, skill] as const),
  );
  return {
    getTool: () => undefined,
    listTools: () => [],
    getSkill: (name: string) => skills.get(name),
  };
}

function createHarness() {
  const database = openDelegationTestDatabase();
  const dispatcher = new ControlledDispatcher();
  const repository = new AgentSqliteChildRunRepository(database);
  const service = new AgentDelegationService({
    workspaceRoot: process.cwd(),
    configuration: () => ({ config: modelConfig() }),
    repository,
    dispatcher,
    events: new AgentOrchestrationEventRelay(),
  });
  return {
    service,
    dispatcher,
    repository,
    close: () => database.close(),
  };
}

class ControlledDispatcher {
  readonly requests: AgentRunDispatchRequest[] = [];
  private readonly pending = new Map<string, DeferredDispatch>();
  readonly requestFinalAnswer = vi.fn(async () => true);
  readonly steer = vi.fn(async () => true);
  readonly followUp = vi.fn(async () => true);
  readonly requestCancellation = vi.fn(async (sessionId: string) => this.pending.has(sessionId));
  readonly cancel = vi.fn(async (sessionId: string) => {
    const deferred = this.pending.get(sessionId);
    if (!deferred) return false;
    deferred.reject(new AgentCancellationError("Child run closed by its parent."));
    return true;
  });

  dispatch(request: AgentRunDispatchRequest): Promise<AgentRunDispatchResult> {
    this.requests.push(request);
    const deferred = createDeferredDispatch();
    this.pending.set(request.sessionId, deferred);
    return deferred.promise.finally(() => this.pending.delete(request.sessionId));
  }

  complete(sessionId: string, finalAnswer: string): void {
    const deferred = this.pending.get(sessionId);
    if (!deferred) throw new Error(`No controlled child dispatch exists for ${sessionId}.`);
    deferred.resolve({ sessionId, requestId: "child-request", finalAnswer });
  }

  async waitForDispatches(count: number): Promise<void> {
    await vi.waitFor(() => expect(this.requests).toHaveLength(count));
  }
}

interface DeferredDispatch {
  readonly promise: Promise<AgentRunDispatchResult>;
  readonly resolve: (result: AgentRunDispatchResult) => void;
  readonly reject: (error: Error) => void;
}

function createDeferredDispatch(): DeferredDispatch {
  let resolve!: (result: AgentRunDispatchResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<AgentRunDispatchResult>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
