import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentDelegationService } from "../../../Source/AgentSystem/Orchestration/AgentDelegationService.js";
import { AgentToolResourceLeaseCoordinator } from "../../../Source/AgentSystem/ToolRuntime/AgentToolResourceScheduler.js";
import {
  AgentRunConcurrencyGate,
  AgentRunPermitKinds,
} from "../../../Source/AgentSystem/Orchestration/AgentRunConcurrencyGate.js";
import { resolveAgentDelegationConfiguration } from "../../../Source/AgentSystem/Orchestration/AgentOrchestrationConfig.js";
import { AgentOrchestrationEventRelay } from "../../../Source/AgentSystem/Orchestration/AgentOrchestrationEventRelay.js";
import { AgentSqliteChildRunRepository } from "../../../Source/AgentSystem/Orchestration/AgentSqliteChildRunRepository.js";
import {
  AgentChildRunModelSelectionSources,
  AgentChildWorkspaceAccessModes,
  type AgentChildRunRepository,
} from "../../../Source/AgentSystem/Orchestration/AgentChildRunTypes.js";
import {
  AgentRunContextModes,
  type AgentRunDispatchRequest,
  type AgentRunDispatchResult,
} from "../../../Source/AgentSystem/Orchestration/AgentRunDispatchPort.js";
import { AgentExecutionApprovalModes } from "../../../Source/AgentSystem/Safety/AgentExecutionApprovalMode.js";
import type { AgentSubagentPreflightPort } from "../../../Source/AgentSystem/Orchestration/AgentSubagentPreflight.js";
import {
  cleanupDelegationTestRoots,
  Deferred,
  delegationPlan,
  modelConfig,
  openDelegationTestDatabase,
  testDeadlinePolicy,
} from "./AgentDelegationTestSupport.js";

afterEach(() => {
  vi.useRealTimers();
  cleanupDelegationTestRoots();
});

describe("agent delegation concurrency and nesting", () => {
  test("bounds depth and active tree size while allowing explicit nullable concurrency", async () => {
    const defaults = resolveAgentDelegationConfiguration(modelConfig());
    expect(defaults.concurrency).toEqual({});
    expect(defaults.execution.maxDepth).toBe(1);
    expect(defaults.execution.maxActivePerTree).toBe(8);
    expect(defaults.workflows).toEqual({});
    expect(defaults.execution.deadline).toMatchObject({
      softTimeoutMs: 900_000,
      wrapUpTimeoutMs: 180_000,
      snapshotIntervalMs: 5_000,
      activityExtension: {
        recentActivityWindowMs: 30_000,
        stepMs: 60_000,
        maximumMs: 120_000,
      },
    });

    const gate = new AgentRunConcurrencyGate({
      maxConcurrentRuns: null,
      maxConcurrentWorkspaceWriters: null,
    });
    const permits = await Promise.all(
      Array.from({ length: 12 }, () => gate.acquire(AgentRunPermitKinds.WorkspaceWrite)),
    );
    expect(gate.snapshot()).toEqual({ activeRuns: 12, activeWriters: 12, queuedRuns: 0 });
    for (const permit of permits) permit.release();
    expect(gate.snapshot()).toEqual({ activeRuns: 0, activeWriters: 0, queuedRuns: 0 });

    gate.updateLimits({ maxConcurrentRuns: 1, maxConcurrentWorkspaceWriters: 1 });
    const first = await gate.acquire(AgentRunPermitKinds.WorkspaceWrite);
    let secondAdmitted = false;
    const second = gate.acquire(AgentRunPermitKinds.WorkspaceWrite).then((permit) => {
      secondAdmitted = true;
      return permit;
    });
    await Promise.resolve();
    expect(secondAdmitted).toBe(false);
    first.release();
    (await second).release();
  });

  test("reuses one durable child for repeated owner and node identities", async () => {
    const database = openDelegationTestDatabase();
    const started = new Deferred<void>();
    const release = new Deferred<void>();
    const dispatch = vi.fn(async (request: AgentRunDispatchRequest): Promise<AgentRunDispatchResult> => {
      started.resolve();
      await release.promise;
      return {
        sessionId: request.sessionId,
        requestId: request.requestId,
        finalAnswer: "Logical node completed once.",
      };
    });
    const preflight = vi.fn(async (input) =>
      delegationPlan("main", [], AgentChildRunModelSelectionSources.Parent, input.workspaceAccess),
    );
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
    const request = {
      agent: "reviewer",
      task: "Review one logical node.",
      ownerRunId: "workflow-1",
      nodeId: "review-node",
      workspaceAccess: AgentChildWorkspaceAccessModes.ReadOnly,
      executionMode: "wait" as const,
    };
    const context = {
      parentSessionId: "parent-session",
      parentRequestId: "parent-request",
      approvalMode: AgentExecutionApprovalModes.Agent,
      authorizedToolNames: ["WorkspaceRead"],
      registry: { getTool: () => undefined },
    };

    const first = service.delegate(request, context);
    await started.promise;
    const second = service.delegate(request, context);
    release.resolve();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(secondResult.id).toBe(firstResult.id);
    expect(firstResult).toMatchObject({ ownerRunId: "workflow-1", nodeId: "review-node" });
    expect(preflight).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledOnce();
    database.close();
  });

  test("derives a stable work item and converges duplicate public submissions", async () => {
    const database = openDelegationTestDatabase();
    const started = new Deferred<void>();
    const release = new Deferred<void>();
    const dispatch = vi.fn(async (request: AgentRunDispatchRequest): Promise<AgentRunDispatchResult> => {
      started.resolve();
      await release.promise;
      return { sessionId: request.sessionId, requestId: request.requestId, finalAnswer: "Completed once." };
    });
    const preflight = vi.fn(async (input) =>
      delegationPlan("main", [], AgentChildRunModelSelectionSources.Parent, input.workspaceAccess),
    );
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
    const request = {
      agent: "reviewer",
      task: "Review one stable logical assignment.",
      workspaceAccess: AgentChildWorkspaceAccessModes.ReadOnly,
      executionMode: "wait" as const,
    };
    const context = {
      parentSessionId: "parent-session",
      parentRequestId: "parent-request",
      approvalMode: AgentExecutionApprovalModes.Agent,
      authorizedToolNames: ["WorkspaceRead"],
      registry: { getTool: () => undefined },
    };

    const first = service.delegate(request, context);
    await started.promise;
    const second = service.delegate(request, context);
    release.resolve();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(secondResult.id).toBe(firstResult.id);
    expect(firstResult.workItemId).toMatch(/^task:/);
    expect(firstResult.taskDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(preflight).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledOnce();
    database.close();
  });

  test("reports whether a spawn created or reused the logical assignment", async () => {
    const database = openDelegationTestDatabase();
    const release = new Deferred<void>();
    const dispatch = vi.fn(async (request: AgentRunDispatchRequest): Promise<AgentRunDispatchResult> => {
      await release.promise;
      return { sessionId: request.sessionId, requestId: request.requestId, finalAnswer: "Completed once." };
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
      preflight: {
        resolve: vi.fn(async (input) =>
          delegationPlan("main", [], AgentChildRunModelSelectionSources.Parent, input.workspaceAccess),
        ),
      } as unknown as AgentSubagentPreflightPort,
    });
    const context = {
      parentSessionId: "parent-session",
      parentRequestId: "parent-request",
      approvalMode: AgentExecutionApprovalModes.Agent,
      authorizedToolNames: ["WorkspaceRead"],
      registry: { getTool: () => undefined },
    };
    const first = await service.spawnWithOutcome({ task: "One logical assignment.", mode: "background" }, context);
    const second = await service.spawnWithOutcome({ task: "One logical assignment.", mode: "background" }, context);

    expect(first.disposition).toBe("created");
    expect(second.disposition).toBe("reused");
    expect(second.run.id).toBe(first.run.id);
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());

    release.resolve();
    await service.wait(first.run.id, context.parentSessionId);
    database.close();
  });

  test("returns promptly when a background submission loses the durable work-item insertion race", async () => {
    const database = openDelegationTestDatabase();
    const release = new Deferred<void>();
    const dispatch = vi.fn(async (request: AgentRunDispatchRequest): Promise<AgentRunDispatchResult> => {
      await release.promise;
      return { sessionId: request.sessionId, requestId: request.requestId, finalAnswer: "Completed once." };
    });
    const repository = new AgentSqliteChildRunRepository(database);
    const create = vi.spyOn(repository, "create");
    let concealedIdentityLookups = 0;
    const racingRepository = new Proxy(repository, {
      get(target, property, receiver) {
        if (property === "getByWorkItem") {
          return (...args: Parameters<AgentSqliteChildRunRepository["getByWorkItem"]>) => {
            if (concealedIdentityLookups > 0) {
              concealedIdentityLookups -= 1;
              return undefined;
            }
            return target.getByWorkItem(...args);
          };
        }
        if (property === "getByOwnerNode") {
          return (...args: Parameters<AgentSqliteChildRunRepository["getByOwnerNode"]>) => {
            if (concealedIdentityLookups > 0) {
              concealedIdentityLookups -= 1;
              return undefined;
            }
            return target.getByOwnerNode(...args);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as unknown as AgentChildRunRepository;
    const service = new AgentDelegationService({
      workspaceRoot: process.cwd(),
      configuration: () => ({ config: modelConfig() }),
      repository: racingRepository,
      dispatcher: {
        dispatch,
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
    const context = {
      parentSessionId: "parent-session",
      parentRequestId: "parent-request",
      approvalMode: AgentExecutionApprovalModes.Agent,
      authorizedToolNames: ["WorkspaceRead"],
      registry: { getTool: () => undefined },
    };
    const request = {
      task: "Review one racing background assignment.",
      mode: "background" as const,
      workItemId: "racing-background-assignment",
    };
    const first = await service.spawnWithOutcome(request, context);

    try {
      await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
      // Simulate an independent runtime inserting the same identity after this
      // service has checked both lookup indexes but before it calls INSERT.
      concealedIdentityLookups = 2;
      const reused = await settleWithin(service.spawnWithOutcome(request, context), 250);

      expect(first.disposition).toBe("created");
      expect(reused.disposition).toBe("reused");
      expect(reused.run.id).toBe(first.run.id);
      expect(concealedIdentityLookups).toBe(0);
      expect(create).toHaveBeenCalledTimes(2);
      expect(dispatch).toHaveBeenCalledOnce();
    } finally {
      release.resolve();
      await service.wait(first.run.id, context.parentSessionId);
      await vi.waitFor(() => expect(service.snapshot().activeRunIds).toEqual([]));
      database.close();
    }
  });

  test("runs read-only child sessions concurrently", async () => {
    const database = openDelegationTestDatabase();
    let active = 0;
    let maximumActive = 0;
    const release = new Deferred<void>();
    const dispatch = vi.fn(async (request: AgentRunDispatchRequest): Promise<AgentRunDispatchResult> => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await release.promise;
      active -= 1;
      return {
        sessionId: request.sessionId,
        requestId: request.requestId,
        finalAnswer: `Completed ${request.input}`,
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
      preflight: {
        resolve: vi.fn(async (input) =>
          delegationPlan("main", [], AgentChildRunModelSelectionSources.Parent, input.workspaceAccess),
        ),
      } as unknown as AgentSubagentPreflightPort,
    });
    const context = {
      parentSessionId: "parent-session",
      parentRequestId: "parent-request",
      approvalMode: AgentExecutionApprovalModes.Agent,
      authorizedToolNames: ["WorkspaceRead"],
      registry: { getTool: () => undefined },
    };
    const runs = [
      service.delegate(
        {
          agent: "reviewer",
          task: "Review architecture.",
          workspaceAccess: AgentChildWorkspaceAccessModes.ReadOnly,
          executionMode: "wait",
        },
        context,
      ),
      service.delegate(
        {
          agent: "scout",
          task: "Inspect tests.",
          workspaceAccess: AgentChildWorkspaceAccessModes.ReadOnly,
          executionMode: "wait",
        },
        context,
      ),
    ];

    try {
      await vi.waitFor(() => expect(maximumActive).toBe(2));
    } finally {
      release.resolve();
      await Promise.all(runs);
      database.close();
    }
  });

  test("limits workspace-writing child sessions independently from read-only capacity", async () => {
    const database = openDelegationTestDatabase();
    const firstStarted = new Deferred<void>();
    const releaseFirst = new Deferred<void>();
    let activeWriters = 0;
    let maximumActiveWriters = 0;
    const dispatch = vi.fn(async (request: AgentRunDispatchRequest): Promise<AgentRunDispatchResult> => {
      activeWriters += 1;
      maximumActiveWriters = Math.max(maximumActiveWriters, activeWriters);
      if (dispatch.mock.calls.length === 1) {
        firstStarted.resolve();
        await releaseFirst.promise;
      }
      activeWriters -= 1;
      return {
        sessionId: request.sessionId,
        requestId: request.requestId,
        finalAnswer: `Completed ${request.input}`,
      };
    });
    const service = new AgentDelegationService({
      workspaceRoot: process.cwd(),
      configuration: () => ({
        config: modelConfig(undefined, { maxWorkspaceWriters: 1 }),
      }),
      repository: new AgentSqliteChildRunRepository(database),
      dispatcher: {
        dispatch,
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
    const context = {
      parentSessionId: "parent-session",
      parentRequestId: "parent-request",
      approvalMode: AgentExecutionApprovalModes.Agent,
      authorizedToolNames: ["ShellCommandTool"],
      registry: { getTool: () => undefined },
    };
    const runs = [
      service.delegate(
        {
          agent: "worker",
          task: "Implement the first change.",
          workspaceAccess: AgentChildWorkspaceAccessModes.ReadWrite,
          executionMode: "wait",
        },
        context,
      ),
      service.delegate(
        {
          agent: "worker",
          task: "Implement the second change.",
          workspaceAccess: AgentChildWorkspaceAccessModes.ReadWrite,
          executionMode: "wait",
        },
        context,
      ),
    ];

    try {
      await firstStarted.promise;
      await Promise.resolve();
      expect(dispatch).toHaveBeenCalledTimes(1);
    } finally {
      releaseFirst.resolve();
      await Promise.all(runs);
      database.close();
    }
    expect(maximumActiveWriters).toBe(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  test("prevents a read-only child session from delegating a workspace writer", async () => {
    const database = openDelegationTestDatabase();
    const repository = new AgentSqliteChildRunRepository(database);
    repository.create({
      id: "read-only-parent",
      parentSessionId: "root-session",
      parentRequestId: "root-request",
      childSessionId: "read-only-child-session",
      childRequestId: "read-only-child-request",
      agentName: "reviewer",
      task: "Review without modifying files.",
      contextMode: AgentRunContextModes.Fresh,
      approvalMode: AgentExecutionApprovalModes.Agent,
      selectedSkills: [],
      launchContractDigest: "read-only-parent-digest",
      launchContract: { version: 2 },
      allowedToolNames: ["WorkspaceRead", "AgentSpawn"],
      executionContract: {
        version: 5,
        workspaceAccess: AgentChildWorkspaceAccessModes.ReadOnly,
        promptLayer: { mode: "replace", content: "Review only." },
        modelCandidateProviderIds: ["main"],
        inheritProjectContext: false,
        deadline: testDeadlinePolicy(),
      },
    });
    const preflight = vi.fn(async () => delegationPlan());
    const service = new AgentDelegationService({
      workspaceRoot: process.cwd(),
      configuration: () => ({ config: modelConfig(null) }),
      repository,
      dispatcher: {
        dispatch: vi.fn(),
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
          agent: "worker",
          task: "Modify the implementation.",
          workspaceAccess: AgentChildWorkspaceAccessModes.ReadWrite,
          executionMode: "wait",
        },
        {
          parentSessionId: "read-only-child-session",
          parentRequestId: "read-only-child-request",
          approvalMode: AgentExecutionApprovalModes.Agent,
          authorizedToolNames: ["AgentSpawn"],
          registry: { getTool: () => undefined },
        },
      ),
    ).rejects.toThrow("read-only child run");
    expect(preflight).not.toHaveBeenCalled();
    database.close();
  });

  test("rejects nested delegation beyond the configured child-session depth", async () => {
    const database = openDelegationTestDatabase();
    const repository = new AgentSqliteChildRunRepository(database);
    repository.create({
      id: "parent-child-run",
      parentSessionId: "root-session",
      parentRequestId: "root-request",
      childSessionId: "nested-parent-session",
      childRequestId: "nested-parent-request",
      agentName: "worker",
      task: "Parent child task.",
      contextMode: AgentRunContextModes.Fresh,
      approvalMode: AgentExecutionApprovalModes.Agent,
      selectedSkills: [],
      launchContractDigest: "parent-digest",
      launchContract: { version: 2 },
      allowedToolNames: ["AgentSpawn"],
      executionContract: {
        version: 5,
        workspaceAccess: AgentChildWorkspaceAccessModes.ReadWrite,
        promptLayer: { mode: "append", content: "" },
        modelCandidateProviderIds: ["main"],
        inheritProjectContext: true,
        deadline: testDeadlinePolicy(),
      },
    });
    const preflight = vi.fn(async () => delegationPlan());
    const service = new AgentDelegationService({
      workspaceRoot: process.cwd(),
      configuration: () => ({ config: modelConfig(1) }),
      repository,
      dispatcher: {
        dispatch: vi.fn(),
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
          agent: "worker",
          task: "Nested task.",
          workspaceAccess: AgentChildWorkspaceAccessModes.ReadWrite,
          executionMode: "wait",
        },
        {
          parentSessionId: "nested-parent-session",
          parentRequestId: "nested-parent-request",
          approvalMode: AgentExecutionApprovalModes.Agent,
          authorizedToolNames: ["AgentSpawn"],
          registry: { getTool: () => undefined },
        },
      ),
    ).rejects.toThrow("configured maximum of 1");
    expect(preflight).not.toHaveBeenCalled();
    database.close();
  });

  test("holds declared child claims across the full child lifecycle", async () => {
    const database = openDelegationTestDatabase();
    const firstStarted = new Deferred<void>();
    const releaseFirst = new Deferred<void>();
    const dispatch = vi.fn(async (request: AgentRunDispatchRequest): Promise<AgentRunDispatchResult> => {
      if (dispatch.mock.calls.length === 1) {
        firstStarted.resolve();
        await releaseFirst.promise;
      }
      return { sessionId: request.sessionId, requestId: request.requestId, finalAnswer: request.input };
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
      preflight: {
        resolve: vi.fn(async (input) =>
          delegationPlan("main", [], AgentChildRunModelSelectionSources.Parent, input.workspaceAccess),
        ),
      } as unknown as AgentSubagentPreflightPort,
      resourceCoordinator: new AgentToolResourceLeaseCoordinator(),
    });
    service.bindResourceClaims({
      project: async () => ({ mode: "claims", claims: [] }),
      listClaimCapabilityIds: () => ["test.workspace"],
      projectDeclarations: async (declarations) => ({
        mode: "claims",
        claims: [
          {
            domain: { id: "test.workspace", overlaps: (left, right) => left === right },
            identity: String(declarations[0]?.value),
            access: "exclusive",
          },
        ],
      }),
    });
    const context = {
      parentSessionId: "parent-session",
      parentRequestId: "parent-request",
      approvalMode: AgentExecutionApprovalModes.Agent,
      authorizedToolNames: ["ShellCommandTool"],
      registry: { getTool: () => undefined },
    };

    const first = await service.spawnWithOutcome(
      {
        agent: "worker",
        task: "Edit the shared file.",
        mode: "background",
        workItemId: "first",
        resources: [{ capability: "test.workspace", value: "Source/shared.ts", intent: "replace" }],
      },
      context,
    );
    await firstStarted.promise;
    const second = await service.spawnWithOutcome(
      {
        agent: "worker",
        task: "Review the shared file.",
        mode: "background",
        workItemId: "second",
        resources: [{ capability: "test.workspace", value: "Source/shared.ts", intent: "replace" }],
      },
      context,
    );

    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(first.run.executionContract.resourceCoverage).toBe("declared");
    expect(first.run.executionContract.resourceClaims).toEqual([
      { domainId: "test.workspace", identity: "Source/shared.ts", access: "exclusive" },
    ]);

    releaseFirst.resolve();
    await Promise.all([
      service.wait(first.run.id, context.parentSessionId),
      service.wait(second.run.id, context.parentSessionId),
    ]);
    expect(dispatch).toHaveBeenCalledTimes(2);
    database.close();
  });
});

function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Promise did not settle within ${timeoutMs}ms.`)), timeoutMs);
    timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
