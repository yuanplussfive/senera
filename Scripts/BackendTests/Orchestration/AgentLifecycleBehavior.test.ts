import { afterEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AgentCancellationError } from "../../../Source/AgentSystem/Core/AgentCancellation.js";
import { AgentJobWaiter } from "../../../Source/AgentSystem/Orchestration/AgentJobWaiter.js";
import { AgentSqliteDatabaseKernel } from "../../../Source/AgentSystem/Database/AgentSqliteDatabaseKernel.js";
import { AgentMemoryDatabaseContract } from "../../../Source/AgentSystem/Memory/AgentMemorySqlSchema.js";
import { AgentTodoService } from "../../../Source/AgentSystem/Todos/AgentTodoService.js";
import { AgentTodoSqliteStore } from "../../../Source/AgentSystem/Todos/AgentTodoSqliteStore.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import {
  AgentEventKinds,
  type AgentDomainEvent,
  type AgentEventSink,
} from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { createAgentOrchestrationHostHandlers } from "../../../Source/AgentSystem/Orchestration/AgentOrchestrationHostTools.js";
import { projectAgentChildRunView } from "../../../Source/AgentSystem/Orchestration/AgentChildRunProjection.js";
import { AgentDelegationService } from "../../../Source/AgentSystem/Orchestration/AgentDelegationService.js";
import {
  AgentSubagentPreflight,
  type AgentSubagentPreflightPort,
} from "../../../Source/AgentSystem/Orchestration/AgentSubagentPreflight.js";
import type { AgentDelegationCompletionPort } from "../../../Source/AgentSystem/Orchestration/AgentDelegationRuntimeContracts.js";
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
import { validateToolContractValue } from "../../../Source/AgentSystem/ToolRuntime/AgentToolSignatureArgumentValidator.js";
import type { AgentHostToolHandler } from "../../../Source/AgentSystem/ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { cleanupDelegationTestRoots, modelConfig, openDelegationTestDatabase } from "./AgentDelegationTestSupport.js";
import { createDeferred } from "../Support/AsyncTestFixtures.js";

afterEach(() => cleanupDelegationTestRoots());

describe("agent lifecycle", () => {
  test("waits through the short-read interval and releases one event-driven read on completion or cancellation", async () => {
    vi.useFakeTimers();
    const waiter = new AgentJobWaiter({ maximumWaitMs: () => 120_000, defaultWaitMs: () => 30_000 });
    let completed = false;
    try {
      const delivered = vi.fn();
      const result = waiter.read(
        "job",
        "parent",
        () => ({ completed }),
        (value) => value.completed,
        {
          wait: true,
          timeoutMs: null,
        },
      );
      void result.then(delivered);
      await vi.advanceTimersByTimeAsync(30_001);
      expect(delivered).not.toHaveBeenCalled();
      completed = true;
      waiter.changed("job");
      await expect(result).resolves.toEqual({ snapshot: { completed: true }, waitReason: "completed" });

      completed = false;
      const controller = new AbortController();
      const cancelled = waiter.read(
        "job",
        "parent",
        () => ({ completed }),
        (value) => value.completed,
        {
          wait: true,
          timeoutMs: null,
          signal: controller.signal,
        },
      );
      const assertion = expect(cancelled).rejects.toThrow("reader stopped");
      controller.abort(new Error("reader stopped"));
      await assertion;
      expect(completed).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      waiter.stop();
      vi.useRealTimers();
    }
  });

  test.each([false, true])(
    "completes an explicitly linked parent Todo without changing a replacement plan (%s)",
    async (replace) => {
      const todo = createTodoFixture();
      const preflight = new AgentSubagentPreflight();
      const resolve = preflight.resolve.bind(preflight);
      const secondAdmission = createDeferred<void>();
      vi.spyOn(preflight, "resolve").mockImplementation(async (input) => {
        if (input.task === "Build CSS") await secondAdmission.promise;
        return resolve(input);
      });
      const harness = createHarness(undefined, todo.service, preflight);
      const events: AgentDomainEvent[] = [];
      harness.events.setSink((event) => {
        events.push(event);
      });
      try {
        const todos = [{ content: "Build the page", status: "in_progress" as const }];
        todo.service.write({ sessionId: "parent-session", todos });
        const first = await harness.service.spawn(
          { task: "Build HTML", mode: "background", todo: "Build the page" },
          parentContext(),
        );
        const pendingSecond = harness.service.spawn(
          { task: "Build CSS", mode: "background", todo: "Build the page" },
          parentContext(),
        );
        await harness.dispatcher.waitForDispatches(1);
        harness.dispatcher.complete(first.childSessionId, "HTML ready");
        await harness.service.wait(first.id, "parent-session");
        expect(todo.service.read("parent-session").counts.inProgress).toBe(1);
        secondAdmission.resolve();
        const second = await pendingSecond;
        await harness.dispatcher.waitForDispatches(2);
        expect(todo.service.read("parent-session").counts.inProgress).toBe(1);
        if (replace) {
          todo.service.write({ sessionId: "parent-session", todos: [] });
          todo.service.write({ sessionId: "parent-session", todos });
        }
        harness.dispatcher.complete(second.childSessionId, "CSS ready");
        await harness.service.wait(second.id, "parent-session");
        expect(todo.service.read("parent-session").items[0]?.status).toBe(replace ? "in_progress" : "completed");
        const repeated = await harness.service.spawn(
          { task: "Build CSS", mode: "background", todo: "Build the page" },
          parentContext(),
        );
        if (replace) {
          expect(repeated.id).not.toBe(second.id);
          await harness.dispatcher.waitForDispatches(3);
          harness.dispatcher.complete(repeated.childSessionId, "New plan CSS ready");
          await harness.service.wait(repeated.id, "parent-session");
        } else {
          expect(repeated.id).toBe(second.id);
        }
        expect(todo.service.read("parent-session").counts.completed).toBe(1);
        expect(events).toContainEqual(
          expect.objectContaining({
            kind: AgentEventKinds.TodoListWritten,
            data: expect.objectContaining({ source: "host" }),
          }),
        );
      } finally {
        secondAdmission.resolve();
        await harness.service.shutdown();
        harness.close();
        todo.close();
      }
    },
  );

  test("recovers parent Todo synchronization without changing a successful child into a failure", async () => {
    const todo = createTodoFixture();
    const harness = createHarness(undefined, todo.service);
    try {
      todo.service.write({ sessionId: "parent-session", todos: [{ content: "Build", status: "pending" }] });
      await expect(
        harness.service.spawn({ task: "Build", mode: "background", todo: "Build" }, parentContext()),
      ).rejects.toThrow("in_progress");
      todo.service.write({ sessionId: "parent-session", todos: [{ content: "Build", status: "in_progress" }] });
      const run = await harness.service.spawn({ task: "Build", mode: "background", todo: "Build" }, parentContext());
      await harness.dispatcher.waitForDispatches(1);
      vi.spyOn(todo.service, "update").mockImplementationOnce(() => {
        throw new Error("Temporary storage failure");
      });
      harness.dispatcher.complete(run.childSessionId, "Built");
      await expect(harness.service.wait(run.id, "parent-session")).resolves.toMatchObject({ status: "completed" });
      expect(todo.service.read("parent-session").counts.inProgress).toBe(1);
      harness.service.bindTodoService(todo.service);
      expect(todo.service.read("parent-session").counts.completed).toBe(1);
    } finally {
      await harness.service.shutdown();
      harness.close();
      todo.close();
    }
  });

  test("projects an unknown run ID to a schema-valid agent list", () => {
    const run = projectAgentChildRunView(undefined, "missing-run");
    const contract = JSON.parse(
      readFileSync(
        path.resolve("System", "Extensions", "coordinate", "agent-delegation", "tools", "list_agents.tool.json"),
        "utf8",
      ),
    ) as { outputSchema: Record<string, unknown> };

    expect(run).toEqual({
      runId: "missing-run",
      state: "not_found",
      resources: { coverage: "unknown", claims: [] },
      delivery: { parentResultDelivered: false },
    });
    expect(
      validateToolContractValue({
        schema: contract.outputSchema,
        value: { self_id: "parent-session", parent_id: null, agents: [] },
      }),
    ).toEqual([]);
  });

  test("launches background work immediately and reads without consuming its completion", async () => {
    const completion = {
      id: "test.completion",
      completed: vi.fn(async () => undefined),
    } satisfies AgentDelegationCompletionPort;
    const harness = createHarness(completion);
    try {
      const handlers = createAgentOrchestrationHostHandlers({ delegation: harness.service, schedules: {} as never });
      const context = hostToolContext();
      const result = await handlers.subagent(
        { description: "Collect", prompt: "Collect independent evidence." },
        context,
      );
      const child = harness.service.list("parent-session")[0]!;
      expect(result).toMatchObject({
        response: { ok: true, result: { agent_id: child.childSessionId, parent_id: "parent-session" } },
      });
      await harness.dispatcher.waitForDispatches(1);
      harness.dispatcher.complete(child.childSessionId, "Independent evidence is ready.");
      await vi.waitFor(() => expect(completion.completed).toHaveBeenCalledOnce());
      await expect(handlers.listAgents({}, context)).resolves.toMatchObject({
        response: {
          ok: true,
          result: {
            self_id: "parent-session",
            agents: [
              expect.objectContaining({
                agent_id: child.childSessionId,
                result_available: true,
                error_available: false,
              }),
            ],
          },
        },
      });
      expect(harness.repository.get(child.id)?.parentResultDeliveredAt).toBeUndefined();
    } finally {
      harness.close();
    }
  });

  test("starts independent children in one native tool batch", async () => {
    const harness = createHarness();
    const handlers = createAgentOrchestrationHostHandlers({
      delegation: harness.service,
      schedules: {} as never,
    });
    const batch = {
      ...hostToolContext(),
      batchId: "native-tool-batch",
      batchToolNames: ["subagent", "subagent"],
    };

    const first = handlers.subagent({ description: "Implementation", prompt: "Inspect the implementation." }, batch);
    const second = handlers.subagent({ description: "Tests", prompt: "Inspect the test coverage." }, batch);
    await harness.dispatcher.waitForDispatches(2);

    const [firstRun, secondRun] = harness.service.list("parent-session");
    expect(firstRun?.joinGroup).toEqual(secondRun?.joinGroup);
    expect(firstRun?.joinGroup).toMatchObject({ mode: "all", expectedCount: 2 });

    harness.dispatcher.complete(firstRun!.childSessionId, "Implementation evidence is ready.");
    harness.dispatcher.complete(secondRun!.childSessionId, "Test evidence is ready.");
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    await harness.service.wait(firstRun!.id, "parent-session");
    await harness.service.wait(secondRun!.id, "parent-session");
    harness.close();
  });

  test("spawns asynchronously with the package-declared default role and host-owned workspace policy", async () => {
    const harness = createHarness();
    const run = await harness.service.spawn(
      { task: "Inspect and improve the assigned scope.", mode: "background" },
      parentContext(),
    );

    expect(run).toMatchObject({
      agentName: "delegate",
      status: AgentChildRunStatuses.Queued,
      executionContract: { workspaceAccess: AgentChildWorkspaceAccessModes.ReadWrite },
    });
    expect(projectAgentChildRunView(run, run.id)).toEqual({
      runId: run.id,
      state: "queued",
      agent: "delegate",
      workItemId: expect.any(String),
      taskDigest: expect.any(String),
      resources: { coverage: "unscoped", claims: [] },
      delivery: { parentResultDelivered: false },
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
      workItemId: expect.any(String),
      taskDigest: expect.any(String),
      resources: { coverage: "unscoped", claims: [] },
      delivery: { parentResultDelivered: false },
      result: { content: "Default child completed." },
      progress: expect.objectContaining({ phase: "completed", activeTools: [], todo: expect.any(Object) }),
    });
    harness.close();
  });

  test("waits for whichever child settles first and never cancels work on wait timeout", async () => {
    const harness = createHarness();
    const first = await harness.service.spawn({ task: "First independent task.", mode: "background" }, parentContext());
    const second = await harness.service.spawn(
      { task: "Second independent task.", mode: "background" },
      parentContext(),
    );
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
    const run = await harness.service.spawn({ task: "Inspect one subsystem.", mode: "background" }, parentContext());
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
        lastActivityAt: "2026-07-11T08:00:01.000+08:00",
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
    const run = await harness.service.spawn({ task: "Inspect one subsystem.", mode: "background" }, parentContext());
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
    const run = await harness.service.spawn({ task: "Collect evidence.", mode: "background" }, context);
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
      expect.any(String),
      expect.objectContaining({ hostInput: expect.objectContaining({ kind: "agent_message" }) }),
      "follow_up",
    );
    expect(harness.dispatcher.followUp).toHaveBeenCalledWith(
      run.childSessionId,
      "Stop the broad scan and focus on the failing contract.",
      undefined,
      expect.any(String),
      expect.objectContaining({ hostInput: expect.objectContaining({ kind: "agent_message" }) }),
      "steer",
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
    const run = await harness.service.spawn({ task: "Finish the evidence scan.", mode: "background" }, context);
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
    const run = await harness.service.spawn({ task: "Collect one fact.", mode: "background" }, context);
    await harness.dispatcher.waitForDispatches(1);
    harness.dispatcher.followUp.mockResolvedValueOnce(false);

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
    const root = await harness.service.spawn(
      { task: "Coordinate one nested task.", mode: "background" },
      parentContext(),
    );
    const child = await harness.service.spawn(
      { task: "Nested task.", mode: "background" },
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
    const submission = new Promise<{ kind: "accepted" }>((resolve) => {
      settleSubmission = () => resolve({ kind: "accepted" });
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
      const run = await service.spawn({ task: "Remain active until cancelled.", mode: "background" }, parentContext());
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

  test("publishes the terminal child state even when the parent request sink is gone", async () => {
    const database = openDelegationTestDatabase();
    const events: AgentDomainEvent[] = [];
    const completion = vi.fn(async () => undefined);
    const relay = new AgentOrchestrationEventRelay();
    relay.setSink((event) => {
      events.push(event);
    });
    const dispatcher = new ControlledDispatcher();
    const repository = new AgentSqliteChildRunRepository(database);
    const service = new AgentDelegationService({
      workspaceRoot: process.cwd(),
      configuration: () => ({ config: modelConfig() }),
      repository,
      dispatcher,
      events: relay,
      completion: { id: "test.cancelled-completion", completed: completion },
    });
    const parentSink = vi.fn(async () => {
      throw new Error("parent request stream is already closed");
    });

    try {
      const run = await service.spawn(
        { task: "Stop cleanly.", mode: "background" },
        { ...parentContext(), onEvent: parentSink },
      );
      await dispatcher.waitForDispatches(1);

      await service.stop(run.id, "parent-session");
      dispatcher.complete(run.childSessionId, "late provider completion");
      await expect(service.wait(run.id, "parent-session")).resolves.toMatchObject({
        status: AgentChildRunStatuses.Cancelled,
      });

      expect(events.some((event) => event.kind === AgentEventKinds.ChildRunCancelled)).toBe(true);
      expect(events.filter((event) => event.kind === AgentEventKinds.ChildRunCancelled)[0]?.eventId).toEqual(
        expect.any(String),
      );
      expect(completion).not.toHaveBeenCalled();
    } finally {
      await service.shutdown();
      database.close();
    }
  });

  test("keeps detached child execution alive when its parent turn is cancelled", async () => {
    const harness = createHarness();
    const parent = new AbortController();
    const run = await harness.service.spawn(
      { task: "Stop when the parent is cancelled.", mode: "background" },
      { ...parentContext(), signal: parent.signal },
    );
    await harness.dispatcher.waitForDispatches(1);

    parent.abort(new AgentCancellationError("Parent stopped."));
    await Promise.resolve();
    expect(harness.dispatcher.requestCancellation).not.toHaveBeenCalled();
    expect(harness.service.get(run.id, "parent-session")?.status).toBe(AgentChildRunStatuses.Running);

    harness.dispatcher.complete(run.childSessionId, "late completion");
    await expect(harness.service.wait(run.id, "parent-session")).resolves.toMatchObject({
      status: AgentChildRunStatuses.Completed,
    });
    harness.close();
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
      .scanRoot(path.resolve("System", "Extensions", "coordinate", "agent-delegation", "skills"))
      .map((skill) => [skill.name, skill] as const),
  );
  return {
    getTool: () => undefined,
    listTools: () => [],
    getSkill: (name: string) => skills.get(name),
  };
}

function createHarness(
  completion?: AgentDelegationCompletionPort,
  todoService?: AgentTodoService,
  preflight?: AgentSubagentPreflightPort,
) {
  const database = openDelegationTestDatabase();
  const dispatcher = new ControlledDispatcher();
  const repository = new AgentSqliteChildRunRepository(database);
  const events = new AgentOrchestrationEventRelay();
  const service = new AgentDelegationService({
    workspaceRoot: process.cwd(),
    configuration: () => ({ config: modelConfig(null) }),
    repository,
    dispatcher,
    events,
    todoService,
    preflight,
    ...(completion ? { completion } : {}),
  });
  return {
    service,
    dispatcher,
    repository,
    events,
    close: () => database.close(),
  };
}

function createTodoFixture() {
  const root = createTemporaryDirectory("senera-linked-todo");
  const database = new AgentSqliteDatabaseKernel({
    databasePath: path.join(root, "memory.sqlite"),
    contract: AgentMemoryDatabaseContract,
  });
  return {
    service: new AgentTodoService({
      store: new AgentTodoSqliteStore(database),
      policy: { maxItems: 16, maxContentCharacters: 1_000, maxResultCharacters: 16_000 },
    }),
    close: () => {
      database.close();
      removeDirectory(root);
    },
  };
}

function hostToolContext(): Parameters<AgentHostToolHandler>[1] {
  return {
    tool: {} as never,
    config: modelConfig(),
    workspaceRoot: process.cwd(),
    registry: testRegistry(),
    executionEnv: {} as never,
    sessionId: "parent-session",
    requestId: "parent-request",
    approvalMode: AgentExecutionApprovalModes.Agent,
    authorizedToolNames: [],
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
