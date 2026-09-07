import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentDelegationService } from "../../../Source/AgentSystem/Orchestration/AgentDelegationService.js";
import { AgentOrchestrationEventRelay } from "../../../Source/AgentSystem/Orchestration/AgentOrchestrationEventRelay.js";
import { AgentSqliteChildRunRepository } from "../../../Source/AgentSystem/Orchestration/AgentSqliteChildRunRepository.js";
import {
  AgentChildRunModelSelectionSources,
  AgentChildRunStatuses,
  AgentChildWorkspaceAccessModes,
} from "../../../Source/AgentSystem/Orchestration/AgentChildRunTypes.js";
import {
  AgentRunContextModes,
  type AgentRunDispatchRequest,
  type AgentRunDispatchResult,
} from "../../../Source/AgentSystem/Orchestration/AgentRunDispatchPort.js";
import { AgentExecutionApprovalModes } from "../../../Source/AgentSystem/Safety/AgentExecutionApprovalMode.js";
import { AgentEventKinds, type AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import type { AgentSubagentPreflightPort } from "../../../Source/AgentSystem/Orchestration/AgentSubagentPreflight.js";
import { AgentSpawnArgumentsSchema } from "../../../Source/AgentSystem/Orchestration/AgentOrchestrationHostTools.js";
import { AgentDelegationCompletionGateway } from "../../../Source/AgentSystem/Orchestration/AgentDelegationRuntimeContracts.js";
import type { AgentChildRunRecord } from "../../../Source/AgentSystem/Orchestration/AgentChildRunTypes.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import type { AgentTodoService, AgentTodoWriteInput } from "../../../Source/AgentSystem/Todos/AgentTodoService.js";
import { AgentTodoStatuses, type AgentTodoSnapshot } from "../../../Source/AgentSystem/Todos/AgentTodoTypes.js";
import {
  cleanupDelegationTestRoots,
  Deferred,
  delegatedModelConfig,
  delegationPlan,
  modelConfig,
  openDelegationTestDatabase as openDatabase,
} from "./AgentDelegationTestSupport.js";

afterEach(() => {
  vi.useRealTimers();
  cleanupDelegationTestRoots();
});

function createTodoDouble(): AgentTodoService {
  const states = new Map<string, AgentTodoSnapshot>();
  const empty = (): AgentTodoSnapshot => ({
    items: [],
    counts: { total: 0, pending: 0, inProgress: 0, completed: 0, cancelled: 0 },
  });
  const read = (sessionId: string): AgentTodoSnapshot => states.get(sessionId) ?? empty();
  const write = (input: AgentTodoWriteInput): AgentTodoSnapshot => {
    const timestamp = new Date(0).toISOString();
    const items = input.items.map((item, order) => ({
      id: item.id,
      content: item.content ?? item.id,
      status: item.status ?? AgentTodoStatuses.Pending,
      order,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
    const snapshot: AgentTodoSnapshot = {
      items,
      counts: {
        total: items.length,
        pending: items.filter((item) => item.status === AgentTodoStatuses.Pending).length,
        inProgress: items.filter((item) => item.status === AgentTodoStatuses.InProgress).length,
        completed: items.filter((item) => item.status === AgentTodoStatuses.Completed).length,
        cancelled: items.filter((item) => item.status === AgentTodoStatuses.Cancelled).length,
      },
    };
    states.set(input.sessionId, snapshot);
    return snapshot;
  };
  return {
    read,
    write,
    fingerprint: (sessionId: string) => JSON.stringify(read(sessionId)),
  } as unknown as AgentTodoService;
}

describe("agent delegation", () => {
  test("fans out detached completion wakes to every bound channel adapter", async () => {
    const gateway = new AgentDelegationCompletionGateway();
    const webSocketAdapter = vi.fn(async () => undefined);
    const qqAdapter = vi.fn(async () => undefined);
    const webSocketUnbind = gateway.bind({ id: "test.websocket", completed: webSocketAdapter });
    const qqUnbind = gateway.bind({ id: "test.qq", completed: qqAdapter });

    await gateway.completed({ id: "childrun_test" } as AgentChildRunRecord);

    expect(webSocketAdapter).toHaveBeenCalledOnce();
    expect(qqAdapter).toHaveBeenCalledOnce();
    webSocketUnbind();
    qqUnbind();
    await gateway.completed({ id: "childrun_after_unbind" } as AgentChildRunRecord);
    expect(webSocketAdapter).toHaveBeenCalledOnce();
    expect(qqAdapter).toHaveBeenCalledOnce();
  });

  test("marks a child partial when the required model Todo plan is missing", async () => {
    const database = openDatabase();
    const todo = createTodoDouble();
    const service = new AgentDelegationService({
      workspaceRoot: process.cwd(),
      configuration: () => ({ config: modelConfig() }),
      repository: new AgentSqliteChildRunRepository(database),
      dispatcher: {
        dispatch: vi.fn(async (request: AgentRunDispatchRequest) => ({
          sessionId: request.sessionId,
          requestId: request.requestId,
          finalAnswer: "returned without a plan",
          completion: "complete" as const,
        })),
        requestFinalAnswer: vi.fn(async () => true),
        requestCancellation: vi.fn(async () => true),
        cancel: vi.fn(async () => true),
      },
      events: new AgentOrchestrationEventRelay(),
      preflight: {
        resolve: vi.fn(async (input) =>
          delegationPlan("main", [], AgentChildRunModelSelectionSources.Parent, input.workspaceAccess),
        ),
      } as unknown as AgentSubagentPreflightPort,
    });
    service.bindTodoService(todo);

    const result = await service.delegate(
      {
        agent: "reviewer",
        task: "Complete a planned review.",
        workspaceAccess: AgentChildWorkspaceAccessModes.ReadOnly,
        executionMode: "wait",
      },
      {
        parentSessionId: "parent-session",
        parentRequestId: "parent-request",
        approvalMode: AgentExecutionApprovalModes.Agent,
        authorizedToolNames: ["WorkspaceRead"],
        registry: { getTool: () => undefined },
      },
    );

    expect(result).toMatchObject({
      status: AgentChildRunStatuses.PartialCompleted,
      finalAnswer: "returned without a plan",
    });
    expect(result.snapshot?.control?.todo.planObserved).toBe(false);
    database.close();
  });

  test("isolates completion adapter failures", async () => {
    const gateway = new AgentDelegationCompletionGateway();
    const failedAdapter = vi.fn(async () => {
      throw new Error("channel_unavailable");
    });
    const healthyAdapter = vi.fn(async () => undefined);
    gateway.bind({ id: "test.failed", completed: failedAdapter });
    gateway.bind({ id: "test.healthy", completed: healthyAdapter });

    await expect(gateway.completed({ id: "childrun_isolated" } as AgentChildRunRecord)).resolves.toBeUndefined();
    expect(failedAdapter).toHaveBeenCalledOnce();
    expect(healthyAdapter).toHaveBeenCalledOnce();
  });

  test("returns an interrupted partial result when execution fails after producing checkpoint text", async () => {
    const database = openDatabase();
    const events: AgentDomainEvent[] = [];
    const service = new AgentDelegationService({
      workspaceRoot: process.cwd(),
      configuration: () => ({ config: modelConfig() }),
      repository: new AgentSqliteChildRunRepository(database),
      dispatcher: {
        dispatch: async (request) => {
          await request.onEvent?.({
            kind: AgentEventKinds.ModelDelta,
            context: { sessionId: request.sessionId, requestId: request.requestId, step: 1 },
            data: { text: "Evidence collected before the provider stream failed." },
          });
          throw new Error("stream_read_error");
        },
        requestFinalAnswer: vi.fn(async () => true),
        requestCancellation: vi.fn(async () => true),
        cancel: vi.fn(async () => true),
      },
      events: new AgentOrchestrationEventRelay(),
      preflight: {
        resolve: vi.fn(async () =>
          delegationPlan(
            "main",
            [],
            AgentChildRunModelSelectionSources.Parent,
            AgentChildWorkspaceAccessModes.ReadOnly,
          ),
        ),
      } as unknown as AgentSubagentPreflightPort,
    });

    const interrupted = await service.delegate(
      {
        agent: "reviewer",
        task: "Review the change.",
        workspaceAccess: AgentChildWorkspaceAccessModes.ReadOnly,
        executionMode: "wait",
      },
      {
        parentSessionId: "parent-session",
        parentRequestId: "parent-request",
        approvalMode: AgentExecutionApprovalModes.Agent,
        authorizedToolNames: ["WorkspaceRead"],
        registry: { getTool: () => undefined },
        onEvent: (event) => {
          events.push(event);
        },
      },
    );

    expect(interrupted).toMatchObject({
      status: AgentChildRunStatuses.Interrupted,
      finalAnswer: "Evidence collected before the provider stream failed.",
      error: "stream_read_error",
      checkpoint: {
        source: "model_stream",
        content: "Evidence collected before the provider stream failed.",
        complete: false,
      },
    });
    expect(events.map((event) => event.kind)).toContain(AgentEventKinds.ChildRunInterrupted);
    database.close();
  });

  test("keeps model and Skill selection host-managed and persists the resolved revisions", async () => {
    const database = openDatabase();
    const dispatch = vi.fn(async (request) => ({
      sessionId: request.sessionId,
      requestId: request.requestId,
      finalAnswer: "delegated result",
    }));
    const preflight = vi.fn(async (input) =>
      delegationPlan(
        input.requestedModelProviderId ?? input.modelPool.fallbackModelProviderId,
        [{ name: "workspace-investigation", revision: "skill-revision-a" }],
        AgentChildRunModelSelectionSources.ExtensionDefault,
      ),
    );
    const service = new AgentDelegationService({
      workspaceRoot: process.cwd(),
      configuration: () => ({ config: delegatedModelConfig(), revision: 29 }),
      repository: new AgentSqliteChildRunRepository(database),
      dispatcher: {
        dispatch,
        requestFinalAnswer: vi.fn(async () => true),
        requestCancellation: vi.fn(async () => true),
        cancel: vi.fn(async () => true),
      },
      events: new AgentOrchestrationEventRelay(),
      preflight: { resolve: preflight } as unknown as AgentSubagentPreflightPort,
    });

    const record = await service.delegate(
      {
        agent: "reviewer",
        task: "Review the change.",
        workspaceAccess: AgentChildWorkspaceAccessModes.ReadWrite,
        executionMode: "wait",
      },
      {
        parentSessionId: "parent-session",
        parentRequestId: "parent-request",
        parentModelProviderId: "main",
        parentThinkingLevel: "high",
        approvalMode: AgentExecutionApprovalModes.Agent,
        authorizedToolNames: ["ShellCommandTool"],
        registry: {
          getTool: () => undefined,
          getSkill: (name) =>
            name === "workspace-investigation"
              ? ({
                  name,
                  revision: "skill-revision-a",
                  source: { id: name },
                } as never)
              : undefined,
        },
      },
    );

    expect(Object.keys(AgentSpawnArgumentsSchema.shape)).toEqual(["task", "agent", "forkContext"]);
    expect(Object.keys(AgentSpawnArgumentsSchema.shape)).not.toEqual(
      expect.arrayContaining(["workspaceAccess", "modelProviderId", "skills", "thinking", "action"]),
    );
    expect(AgentSpawnArgumentsSchema.parse({ task: "Review the change." })).toEqual({
      task: "Review the change.",
    });
    expect(preflight).toHaveBeenCalledWith(
      expect.objectContaining({
        parentModelProviderId: "main",
        parentThinkingLevel: "high",
        configuredThinkingLevel: "medium",
        requestedModelProviderId: undefined,
        modelPool: expect.objectContaining({ modelProviderIds: ["child-model"] }),
      }),
    );
    expect(record).toMatchObject({
      launchContractDigest: "launch",
      modelProviderId: "child-model",
      modelSelectionSource: AgentChildRunModelSelectionSources.ExtensionDefault,
      selectedSkills: [{ name: "workspace-investigation", revision: "skill-revision-a" }],
      configurationRevision: 29,
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        modelProviderId: "child-model",
        pinnedSkills: [{ name: "workspace-investigation", revision: "skill-revision-a" }],
      }),
    );
    database.close();
  });

  test("runs child work through the Senera dispatch port with inherited policy", async () => {
    const database = openDatabase();
    const events: AgentDomainEvent[] = [];
    const dispatch = vi.fn(async (request) => ({
      sessionId: request.sessionId,
      requestId: request.requestId,
      finalAnswer: "review complete",
    }));
    const preflight = vi.fn(async () => delegationPlan("main", [], AgentChildRunModelSelectionSources.Parent));
    const service = new AgentDelegationService({
      workspaceRoot: process.cwd(),
      configuration: () => ({ config: modelConfig() }),
      repository: new AgentSqliteChildRunRepository(database),
      dispatcher: {
        dispatch,
        requestFinalAnswer: vi.fn(async () => true),
        requestCancellation: vi.fn(async () => true),
        cancel: vi.fn(async () => true),
      },
      events: new AgentOrchestrationEventRelay(),
      preflight: { resolve: preflight } as unknown as AgentSubagentPreflightPort,
    });

    const record = await service.delegate(
      {
        agent: "reviewer",
        task: "Review the change.",
        workspaceAccess: AgentChildWorkspaceAccessModes.ReadWrite,
        context: AgentRunContextModes.Fork,
        executionMode: "wait",
      },
      {
        parentSessionId: "parent-session",
        parentRequestId: "parent-request",
        parentModelProviderId: "main",
        approvalMode: AgentExecutionApprovalModes.AlwaysAsk,
        authorizedToolNames: ["ShellCommandTool"],
        registry: { getTool: () => undefined },
        onEvent: (event) => {
          events.push(event);
        },
      },
    );

    expect(record).toMatchObject({ status: AgentChildRunStatuses.Completed, finalAnswer: "review complete" });
    expect(preflight).toHaveBeenCalledWith(
      expect.objectContaining({
        parentModelProviderId: "main",
        requestedModelProviderId: undefined,
        requestedModelSelectionSource: undefined,
        modelPool: expect.objectContaining({ inheritedModelProviderId: "main", modelProviderIds: ["main"] }),
      }),
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalMode: AgentExecutionApprovalModes.AlwaysAsk,
        modelProviderId: "main",
        systemPromptLayer: { mode: "replace", content: "Reviewer role prompt" },
        allowedToolNames: ["ShellCommandTool"],
        parent: { sessionId: "parent-session", requestId: "parent-request" },
        scope: expect.objectContaining({ childRunId: record.id, agentName: "reviewer", role: "childAgent" }),
      }),
    );
    expect(events.map((event) => event.kind)).toEqual([
      AgentEventKinds.ChildRunQueued,
      AgentEventKinds.ChildRunStarted,
      AgentEventKinds.ChildRunSnapshotUpdated,
      AgentEventKinds.ChildRunSnapshotUpdated,
      AgentEventKinds.ChildRunCompleted,
    ]);
    database.close();
  });

  test("notifies the completion port for a detached child after its terminal record is persisted", async () => {
    const database = openDatabase();
    const completion = vi.fn(async () => undefined);
    const service = new AgentDelegationService({
      workspaceRoot: process.cwd(),
      configuration: () => ({ config: modelConfig() }),
      repository: new AgentSqliteChildRunRepository(database),
      dispatcher: {
        dispatch: vi.fn(async (request: AgentRunDispatchRequest): Promise<AgentRunDispatchResult> => ({
          sessionId: request.sessionId,
          requestId: request.requestId,
          finalAnswer: "background work complete",
        })),
        requestFinalAnswer: vi.fn(async () => true),
        requestCancellation: vi.fn(async () => true),
        cancel: vi.fn(async () => true),
      },
      events: new AgentOrchestrationEventRelay(),
      completion: { id: "test.completion", completed: completion },
      preflight: { resolve: vi.fn(async () => delegationPlan()) } as unknown as AgentSubagentPreflightPort,
    });

    const detached = await service.delegate(
      {
        agent: "worker",
        task: "Run in the background.",
        workspaceAccess: AgentChildWorkspaceAccessModes.ReadWrite,
        executionMode: "detach",
      },
      {
        parentSessionId: "parent-session",
        parentRequestId: "parent-request",
        approvalMode: AgentExecutionApprovalModes.Agent,
        authorizedToolNames: [],
        registry: { getTool: () => undefined },
      },
    );

    expect(detached.status).toBe(AgentChildRunStatuses.Queued);
    expect(detached.launchContract).toMatchObject({ executionMode: "detach" });
    await expect(service.wait(detached.id, "parent-session")).resolves.toMatchObject({
      status: AgentChildRunStatuses.Completed,
      finalAnswer: "background work complete",
    });
    await vi.waitFor(() => expect(completion).toHaveBeenCalledOnce());
    expect(completion).toHaveBeenCalledWith(
      expect.objectContaining({ id: detached.id, status: AgentChildRunStatuses.Completed }),
    );
    database.close();
  });

  test("uses the current deadline configuration and requests a bounded final answer at the soft limit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-08T00:00:00.000Z");
    const database = openDatabase();
    const events: AgentDomainEvent[] = [];
    const result = new Deferred<AgentRunDispatchResult>();
    const started = new Deferred<void>();
    let activeRequest: AgentRunDispatchRequest | undefined;
    const dispatch = vi.fn(async (request: AgentRunDispatchRequest): Promise<AgentRunDispatchResult> => {
      activeRequest = request;
      started.resolve();
      return result.promise;
    });
    const requestFinalAnswer = vi.fn(async () => {
      if (!activeRequest) throw new Error("Child dispatch did not start before wrap-up.");
      result.resolve({
        sessionId: activeRequest.sessionId,
        requestId: activeRequest.requestId,
        finalAnswer: "Summary from collected evidence.",
      });
      return true;
    });
    const configuration: AgentSystemConfig = {
      ...modelConfig(),
      Extensions: {
        "agent-delegation": {
          Configuration: {
            execution: {
              maxDepth: 2,
              deadline: {
                softTimeoutMs: 60_000,
                wrapUpTimeoutMs: 10_000,
                snapshotIntervalMs: 500,
                activityExtension: {
                  recentActivityWindowMs: 5_000,
                  stepMs: 5_000,
                  maximumMs: 0,
                },
              },
            },
          },
        },
      },
    };
    const service = new AgentDelegationService({
      workspaceRoot: process.cwd(),
      configuration: () => ({ config: configuration, revision: 41 }),
      repository: new AgentSqliteChildRunRepository(database),
      dispatcher: {
        dispatch,
        requestFinalAnswer,
        requestCancellation: vi.fn(async () => true),
        cancel: vi.fn(async () => true),
      },
      events: new AgentOrchestrationEventRelay(),
      preflight: {
        resolve: vi.fn(async (input) =>
          delegationPlan("main", [], AgentChildRunModelSelectionSources.Parent, input.workspaceAccess),
        ),
      } as unknown as AgentSubagentPreflightPort,
    });

    const completion = service.delegate(
      {
        agent: "reviewer",
        task: "Review until the configured soft deadline.",
        workspaceAccess: AgentChildWorkspaceAccessModes.ReadOnly,
        executionMode: "wait",
      },
      {
        parentSessionId: "parent-session",
        parentRequestId: "parent-request",
        approvalMode: AgentExecutionApprovalModes.Agent,
        authorizedToolNames: ["WorkspaceRead"],
        registry: { getTool: () => undefined },
        onEvent: (event) => {
          events.push(event);
        },
      },
    );
    await started.promise;
    await vi.advanceTimersByTimeAsync(60_000);

    await expect(completion).resolves.toMatchObject({
      status: AgentChildRunStatuses.Completed,
      finalAnswer: "Summary from collected evidence.",
      configurationRevision: 41,
      executionContract: {
        deadline: expect.objectContaining({ softTimeoutMs: 60_000, wrapUpTimeoutMs: 10_000 }),
      },
    });
    expect(requestFinalAnswer).toHaveBeenCalledOnce();
    expect(events.map((event) => event.kind)).toContain(AgentEventKinds.ChildRunWrappingUp);
    expect(events.map((event) => event.kind)).not.toContain(AgentEventKinds.ChildRunTimedOut);
    database.close();
  });

  test("rejects an unavailable requested model before subagent preflight or dispatch", async () => {
    const database = openDatabase();
    const repository = new AgentSqliteChildRunRepository(database);
    const preflight = vi.fn();
    const dispatch = vi.fn();
    const service = new AgentDelegationService({
      workspaceRoot: process.cwd(),
      configuration: () => ({ config: modelConfig() }),
      repository,
      dispatcher: {
        dispatch,
        requestFinalAnswer: vi.fn(async () => true),
        requestCancellation: vi.fn(async () => true),
        cancel: vi.fn(async () => true),
      },
      events: new AgentOrchestrationEventRelay(),
      preflight: { resolve: preflight } as unknown as AgentSubagentPreflightPort,
    });

    await expect(
      service.delegate(
        {
          agent: "reviewer",
          task: "Review the change.",
          workspaceAccess: AgentChildWorkspaceAccessModes.ReadOnly,
          executionMode: "wait",
          modelProviderId: "missing-child-model",
        },
        {
          parentSessionId: "parent-session",
          parentRequestId: "parent-request",
          parentModelProviderId: "main",
          approvalMode: AgentExecutionApprovalModes.Agent,
          authorizedToolNames: ["WorkspaceRead"],
          registry: { getTool: () => undefined },
        },
      ),
    ).rejects.toMatchObject({
      messageKey: "orchestration.modelNotAllowed",
      messageParams: { modelProviderId: "missing-child-model" },
    });
    expect(preflight).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(repository.listForParent("parent-session")).toEqual([]);
    database.close();
  });

  test("closes delegation admission before draining a pending preflight", async () => {
    const database = openDatabase();
    const repository = new AgentSqliteChildRunRepository(database);
    const dispatch = vi.fn();
    let resolvePreflight!: (plan: ReturnType<typeof delegationPlan>) => void;
    const preflight = new Promise<ReturnType<typeof delegationPlan>>((resolve) => {
      resolvePreflight = resolve;
    });
    const service = new AgentDelegationService({
      workspaceRoot: process.cwd(),
      configuration: () => ({ config: modelConfig() }),
      repository,
      dispatcher: {
        dispatch,
        requestFinalAnswer: vi.fn(async () => true),
        requestCancellation: vi.fn(async () => true),
        cancel: vi.fn(async () => true),
      },
      events: new AgentOrchestrationEventRelay(),
      preflight: { resolve: vi.fn(() => preflight) } as unknown as AgentSubagentPreflightPort,
    });

    const delegating = service.delegate(
      {
        agent: "reviewer",
        task: "Review the change.",
        workspaceAccess: AgentChildWorkspaceAccessModes.ReadWrite,
        executionMode: "detach",
      },
      {
        parentSessionId: "parent-session",
        parentRequestId: "parent-request",
        approvalMode: AgentExecutionApprovalModes.Agent,
        authorizedToolNames: ["ShellCommandTool"],
        registry: { getTool: () => undefined },
      },
    );
    const stopping = service.shutdown();
    expect(service.shutdown()).toBe(stopping);
    resolvePreflight(delegationPlan());

    await expect(delegating).rejects.toThrow(/shutting down/u);
    await stopping;
    expect(dispatch).not.toHaveBeenCalled();
    expect(repository.listForParent("parent-session")).toEqual([]);
    database.close();
  });

  test("checkpoints a decision request and resumes the same child session after a supervisor response", async () => {
    const database = openDatabase();
    const repository = new AgentSqliteChildRunRepository(database);
    const events: AgentDomainEvent[] = [];
    let dispatchCount = 0;
    const dispatch = vi.fn(async (request: AgentRunDispatchRequest): Promise<AgentRunDispatchResult> => {
      dispatchCount += 1;
      if (dispatchCount === 1) {
        await service.contactSupervisor(
          request.sessionId,
          request.requestId,
          { reason: "need_decision", message: "Use the safe migration path?" },
          request.onEvent,
        );
        throw new Error("Agent child run completed without a terminal answer.");
      }
      return {
        sessionId: request.sessionId,
        requestId: request.requestId,
        finalAnswer: "Migration completed through the approved path.",
      };
    });
    const service = new AgentDelegationService({
      workspaceRoot: process.cwd(),
      configuration: () => ({ config: modelConfig() }),
      repository,
      dispatcher: {
        dispatch,
        requestFinalAnswer: vi.fn(async () => true),
        requestCancellation: vi.fn(async () => true),
        cancel: vi.fn(async () => true),
      },
      events: new AgentOrchestrationEventRelay(),
      preflight: { resolve: vi.fn(async () => delegationPlan()) } as unknown as AgentSubagentPreflightPort,
    });
    const context = {
      parentSessionId: "parent-session",
      parentRequestId: "parent-request",
      parentModelProviderId: "main",
      approvalMode: AgentExecutionApprovalModes.Agent,
      authorizedToolNames: ["ShellCommandTool"],
      registry: { getTool: () => undefined },
      onEvent: (event: AgentDomainEvent) => {
        events.push(event);
      },
    };

    const waiting = await service.delegate(
      {
        agent: "worker",
        task: "Apply the migration.",
        workspaceAccess: AgentChildWorkspaceAccessModes.ReadWrite,
        executionMode: "wait",
      },
      context,
    );
    expect(waiting).toMatchObject({
      status: AgentChildRunStatuses.AwaitingSupervisor,
      messages: [expect.objectContaining({ kind: "decision", content: "Use the safe migration path?" })],
    });
    const initialRequestId = waiting.childRequestId;

    const submission = await service.sendInput(
      waiting.id,
      context.parentSessionId,
      "Yes, use the safe path.",
      false,
      context,
    );
    expect(submission?.message).toMatchObject({ kind: "response", content: "Yes, use the safe path." });
    const completed = await service.wait(waiting.id, context.parentSessionId);
    expect(completed).toMatchObject({
      status: AgentChildRunStatuses.Completed,
      finalAnswer: "Migration completed through the approved path.",
      childSessionId: waiting.childSessionId,
      messages: [
        expect.objectContaining({ kind: "decision" }),
        expect.objectContaining({ kind: "response", content: "Yes, use the safe path." }),
      ],
    });
    expect(completed?.childRequestId).not.toBe(initialRequestId);
    expect(dispatch.mock.calls[1]?.[0]).toMatchObject({
      sessionId: waiting.childSessionId,
      contextMode: AgentRunContextModes.Fresh,
      input: expect.stringContaining("Yes, use the safe path."),
    });
    expect(events.map((event) => event.kind)).toEqual([
      AgentEventKinds.ChildRunQueued,
      AgentEventKinds.ChildRunStarted,
      AgentEventKinds.ChildRunSnapshotUpdated,
      AgentEventKinds.ChildRunMessageCreated,
      AgentEventKinds.ChildRunAwaitingSupervisor,
      AgentEventKinds.ChildRunMessageCreated,
      AgentEventKinds.ChildRunResumed,
      AgentEventKinds.ChildRunSnapshotUpdated,
      AgentEventKinds.ChildRunSnapshotUpdated,
      AgentEventKinds.ChildRunCompleted,
    ]);
    database.close();
  });

  test("records a progress update without suspending the active child turn", async () => {
    const database = openDatabase();
    const events: AgentDomainEvent[] = [];
    const dispatch = vi.fn(async (request: AgentRunDispatchRequest): Promise<AgentRunDispatchResult> => {
      const progress = await service.contactSupervisor(
        request.sessionId,
        request.requestId,
        { reason: "progress_update", message: "Repository scan completed." },
        request.onEvent,
      );
      expect(progress.run.status).toBe(AgentChildRunStatuses.Running);
      return {
        sessionId: request.sessionId,
        requestId: request.requestId,
        finalAnswer: "Review completed after the scan.",
      };
    });
    const service = new AgentDelegationService({
      workspaceRoot: process.cwd(),
      configuration: () => ({ config: modelConfig() }),
      repository: new AgentSqliteChildRunRepository(database),
      dispatcher: {
        dispatch,
        requestFinalAnswer: vi.fn(async () => true),
        requestCancellation: vi.fn(async () => true),
        cancel: vi.fn(async () => true),
      },
      events: new AgentOrchestrationEventRelay(),
      preflight: { resolve: vi.fn(async () => delegationPlan()) } as unknown as AgentSubagentPreflightPort,
    });

    const completed = await service.delegate(
      {
        agent: "worker",
        task: "Review the repository.",
        workspaceAccess: AgentChildWorkspaceAccessModes.ReadWrite,
        executionMode: "wait",
      },
      {
        parentSessionId: "parent-session",
        parentRequestId: "parent-request",
        approvalMode: AgentExecutionApprovalModes.Agent,
        authorizedToolNames: [],
        registry: { getTool: () => undefined },
        onEvent: (event) => {
          events.push(event);
        },
      },
    );

    expect(completed).toMatchObject({
      status: AgentChildRunStatuses.Completed,
      messages: [expect.objectContaining({ kind: "progress", content: "Repository scan completed." })],
    });
    expect(events.map((event) => event.kind)).not.toContain(AgentEventKinds.ChildRunAwaitingSupervisor);
    database.close();
  });

  test("cancels a persisted supervisor wait even after the active turn has ended", async () => {
    const database = openDatabase();
    const dispatch = vi.fn(async (request: AgentRunDispatchRequest): Promise<AgentRunDispatchResult> => {
      await service.contactSupervisor(
        request.sessionId,
        request.requestId,
        { reason: "need_decision", message: "Continue?" },
        request.onEvent,
      );
      throw new Error("Agent child run completed without a terminal answer.");
    });
    const service = new AgentDelegationService({
      workspaceRoot: process.cwd(),
      configuration: () => ({ config: modelConfig() }),
      repository: new AgentSqliteChildRunRepository(database),
      dispatcher: {
        dispatch,
        requestFinalAnswer: vi.fn(async () => true),
        requestCancellation: vi.fn(async () => true),
        cancel: vi.fn(async () => true),
      },
      events: new AgentOrchestrationEventRelay(),
      preflight: { resolve: vi.fn(async () => delegationPlan()) } as unknown as AgentSubagentPreflightPort,
    });
    const waiting = await service.delegate(
      {
        agent: "worker",
        task: "Inspect.",
        workspaceAccess: AgentChildWorkspaceAccessModes.ReadWrite,
        executionMode: "wait",
      },
      {
        parentSessionId: "parent-session",
        parentRequestId: "parent-request",
        approvalMode: AgentExecutionApprovalModes.Agent,
        authorizedToolNames: [],
        registry: { getTool: () => undefined },
      },
    );

    expect((await service.cancel(waiting.id, "parent-session"))?.status).toBe(AgentChildRunStatuses.Cancelled);
    database.close();
  });

  test("persists terminal assistant text as the only child-run completion result", async () => {
    const database = openDatabase();
    const dispatch = vi.fn(async (request: AgentRunDispatchRequest): Promise<AgentRunDispatchResult> => ({
      sessionId: request.sessionId,
      requestId: request.requestId,
      finalAnswer: "Decision: approved.\n\nEvidence is recorded in the child session.",
    }));
    const service = new AgentDelegationService({
      workspaceRoot: process.cwd(),
      configuration: () => ({ config: modelConfig() }),
      repository: new AgentSqliteChildRunRepository(database),
      dispatcher: {
        dispatch,
        requestFinalAnswer: vi.fn(async () => true),
        requestCancellation: vi.fn(async () => true),
        cancel: vi.fn(async () => true),
      },
      events: new AgentOrchestrationEventRelay(),
      preflight: { resolve: vi.fn(async () => delegationPlan()) } as unknown as AgentSubagentPreflightPort,
    });

    const completed = await service.delegate(
      {
        agent: "worker",
        task: "Return a decision.",
        workspaceAccess: AgentChildWorkspaceAccessModes.ReadWrite,
        executionMode: "wait",
      },
      {
        parentSessionId: "parent-session",
        parentRequestId: "parent-request",
        approvalMode: AgentExecutionApprovalModes.Agent,
        authorizedToolNames: [],
        registry: { getTool: () => undefined },
      },
    );

    expect(completed).toMatchObject({
      status: AgentChildRunStatuses.Completed,
      finalAnswer: "Decision: approved.\n\nEvidence is recorded in the child session.",
      executionContract: { version: 5 },
    });
    expect(completed).not.toHaveProperty("structuredResult");
    expect(
      AgentSpawnArgumentsSchema.safeParse({
        task: "Return a decision.",
        outputSchema: { type: "object" },
      }).success,
    ).toBe(false);
    database.close();
  });
});
