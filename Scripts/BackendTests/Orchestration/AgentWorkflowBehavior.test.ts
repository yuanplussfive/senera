import { afterEach, describe, expect, test, vi } from "vitest";
import { createRequestId, createSessionId } from "../../../Source/AgentSystem/Core/AgentIds.js";
import { AgentOrchestrationEventRelay } from "../../../Source/AgentSystem/Orchestration/AgentOrchestrationEventRelay.js";
import { AgentSqliteChildRunRepository } from "../../../Source/AgentSystem/Orchestration/AgentSqliteChildRunRepository.js";
import { AgentSqliteWorkflowRepository } from "../../../Source/AgentSystem/Orchestration/AgentSqliteWorkflowRepository.js";
import {
  AgentChildRunModelSelectionSources,
  AgentChildWorkspaceAccessModes,
  type AgentChildRunRecord,
} from "../../../Source/AgentSystem/Orchestration/AgentChildRunTypes.js";
import type {
  AgentDelegationContext,
  AgentDelegationRequest,
} from "../../../Source/AgentSystem/Orchestration/AgentDelegationService.js";
import { AgentRunContextModes } from "../../../Source/AgentSystem/Orchestration/AgentRunDispatchPort.js";
import {
  AgentWorkflowExecutionModes,
  AgentWorkflowService,
  type AgentWorkflowDelegationPort,
} from "../../../Source/AgentSystem/Orchestration/AgentWorkflowService.js";
import {
  AgentWorkflowFailurePolicies,
  AgentWorkflowNodeStatuses,
  AgentWorkflowStatuses,
  parseAgentWorkflowDefinition,
} from "../../../Source/AgentSystem/Orchestration/AgentWorkflowTypes.js";
import { AgentExecutionApprovalModes } from "../../../Source/AgentSystem/Safety/AgentExecutionApprovalMode.js";
import {
  cleanupDelegationTestRoots,
  Deferred,
  openDelegationTestDatabase,
  testDeadlinePolicy,
} from "./AgentDelegationTestSupport.js";

afterEach(cleanupDelegationTestRoots);

describe("native subagent workflows", () => {
  test("starts independent nodes together and hands their persisted text to a dependent node", async () => {
    const database = openDelegationTestDatabase();
    const childRuns = new AgentSqliteChildRunRepository(database);
    const delegation = new ControlledDelegation(childRuns);
    const workflows = new AgentWorkflowService({
      repository: new AgentSqliteWorkflowRepository(database),
      delegation,
      events: new AgentOrchestrationEventRelay(),
      maxNodes: () => undefined,
    });

    const completion = workflows.start(
      {
        nodes: [
          node("backend", "Review backend."),
          node("frontend", "Review frontend."),
          node("merge", "Synthesize the reviews.", ["backend", "frontend"]),
        ],
      },
      AgentWorkflowExecutionModes.Wait,
      workflowContext(),
    );

    await vi.waitFor(() =>
      expect(delegation.requests.map((request) => request.nodeId)).toEqual(["backend", "frontend"]),
    );
    delegation.complete("backend", "Backend evidence.");
    delegation.complete("frontend", "Frontend evidence.");
    await vi.waitFor(() => expect(delegation.requests).toHaveLength(3));

    const merge = delegation.requests[2]!;
    expect(merge.nodeId).toBe("merge");
    expect(merge.task).toContain("### backend\nBackend evidence.");
    expect(merge.task).toContain("### frontend\nFrontend evidence.");
    delegation.complete("merge", "Combined result.");

    const completed = await completion;
    expect(completed.status).toBe(AgentWorkflowStatuses.Completed);
    expect(completed.nodes.map((entry) => entry.status)).toEqual([
      AgentWorkflowNodeStatuses.Completed,
      AgentWorkflowNodeStatuses.Completed,
      AgentWorkflowNodeStatuses.Completed,
    ]);
    expect(workflows.projectResult(completed).results).toEqual([
      expect.objectContaining({ nodeId: "backend", finalAnswer: "Backend evidence." }),
      expect.objectContaining({ nodeId: "frontend", finalAnswer: "Frontend evidence." }),
      expect.objectContaining({ nodeId: "merge", finalAnswer: "Combined result." }),
    ]);
    await workflows.shutdown();
    database.close();
  });

  test("continues independent work and skips only nodes whose dependencies failed", async () => {
    const database = openDelegationTestDatabase();
    const delegation = new ControlledDelegation(new AgentSqliteChildRunRepository(database));
    const workflows = new AgentWorkflowService({
      repository: new AgentSqliteWorkflowRepository(database),
      delegation,
      events: new AgentOrchestrationEventRelay(),
      maxNodes: () => 16,
    });
    const completion = workflows.start(
      {
        failurePolicy: AgentWorkflowFailurePolicies.ContinueIndependent,
        nodes: [
          node("failed-root", "Fail this branch."),
          node("healthy-root", "Complete this branch."),
          node("blocked", "Depends on the failed branch.", ["failed-root"]),
          node("healthy-child", "Continue the healthy branch.", ["healthy-root"]),
        ],
      },
      AgentWorkflowExecutionModes.Wait,
      workflowContext(),
    );

    await vi.waitFor(() => expect(delegation.requests).toHaveLength(2));
    delegation.fail("failed-root", "Review failed.");
    delegation.complete("healthy-root", "Healthy evidence.");
    await vi.waitFor(() => expect(delegation.requests).toHaveLength(3));
    expect(delegation.requests[2]!.nodeId).toBe("healthy-child");
    delegation.complete("healthy-child", "Healthy follow-up.");

    const completed = await completion;
    expect(completed.status).toBe(AgentWorkflowStatuses.PartialCompleted);
    expect(Object.fromEntries(completed.nodes.map((entry) => [entry.nodeId, entry.status]))).toEqual({
      "failed-root": AgentWorkflowNodeStatuses.Failed,
      "healthy-root": AgentWorkflowNodeStatuses.Completed,
      blocked: AgentWorkflowNodeStatuses.Skipped,
      "healthy-child": AgentWorkflowNodeStatuses.Completed,
    });
    await workflows.shutdown();
    database.close();
  });

  test("rejects cyclic graphs and configured node-count overflow before delegation", async () => {
    expect(() =>
      parseAgentWorkflowDefinition({
        nodes: [node("a", "A", ["b"]), node("b", "B", ["a"])],
      }),
    ).toThrow(/dependency cycle/i);

    const database = openDelegationTestDatabase();
    const delegation = new ControlledDelegation(new AgentSqliteChildRunRepository(database));
    const workflows = new AgentWorkflowService({
      repository: new AgentSqliteWorkflowRepository(database),
      delegation,
      events: new AgentOrchestrationEventRelay(),
      maxNodes: () => 1,
    });
    await expect(
      workflows.start(
        { nodes: [node("a", "A"), node("b", "B")] },
        AgentWorkflowExecutionModes.Detach,
        workflowContext(),
      ),
    ).rejects.toThrow(/configured maximum is 1/i);
    expect(delegation.requests).toHaveLength(0);
    await workflows.shutdown();
    database.close();
  });
});

class ControlledDelegation implements AgentWorkflowDelegationPort {
  readonly requests: AgentDelegationRequest[] = [];
  private readonly deferred = new Map<string, Deferred<AgentChildRunRecord>>();

  constructor(private readonly repository: AgentSqliteChildRunRepository) {}

  async delegate(request: AgentDelegationRequest, context: AgentDelegationContext): Promise<AgentChildRunRecord> {
    this.requests.push(request);
    const nodeId = request.nodeId!;
    const id = `child-${nodeId}`;
    const capabilityCeiling = {
      version: 2 as const,
      allowedTools: [],
      allowedAgents: [],
      denyExtensions: true,
      sources: ["senera.workflow-test"],
    };
    const child = this.repository.create({
      id,
      ownerRunId: request.ownerRunId,
      nodeId,
      parentSessionId: context.parentSessionId,
      parentRequestId: context.parentRequestId,
      childSessionId: createSessionId(),
      childRequestId: createRequestId(),
      agentName: request.agent,
      task: request.task,
      contextMode: request.context ?? AgentRunContextModes.Fresh,
      approvalMode: context.approvalMode,
      modelSelectionSource: AgentChildRunModelSelectionSources.Parent,
      selectedSkills: [],
      launchContractDigest: `digest-${nodeId}`,
      launchContract: {
        version: 2,
        role: { id: request.agent },
        tools: { capabilityCeiling },
      },
      allowedToolNames: [],
      executionContract: {
        version: 5,
        workspaceAccess: request.workspaceAccess,
        promptLayer: { mode: "replace", content: "Test role." },
        modelCandidateProviderIds: [],
        inheritProjectContext: true,
        capabilityCeiling,
        deadline: testDeadlinePolicy(),
      },
    });
    this.repository.markRunning(id);
    this.deferred.set(nodeId, new Deferred<AgentChildRunRecord>());
    return this.repository.get(child.id)!;
  }

  get(id: string, parentSessionId: string): AgentChildRunRecord | undefined {
    const child = this.repository.get(id);
    return child?.parentSessionId === parentSessionId ? child : undefined;
  }

  listForOwner(ownerRunId: string): AgentChildRunRecord[] {
    return this.repository.listForOwner(ownerRunId);
  }

  wait(id: string, parentSessionId: string): Promise<AgentChildRunRecord | undefined> {
    const child = this.get(id, parentSessionId);
    if (!child) return Promise.resolve(undefined);
    return this.deferred.get(child.nodeId)!.promise;
  }

  cancel(id: string, parentSessionId: string): Promise<AgentChildRunRecord | undefined> {
    const child = this.get(id, parentSessionId);
    if (!child) return Promise.resolve(undefined);
    const cancelled = this.repository.markCancelled(id)!;
    this.deferred.get(child.nodeId)?.resolve(cancelled);
    return Promise.resolve(cancelled);
  }

  resume(id: string, parentSessionId: string): Promise<AgentChildRunRecord | undefined> {
    return Promise.resolve(this.get(id, parentSessionId));
  }

  complete(nodeId: string, finalAnswer: string): void {
    const completed = this.repository.markCompleted(`child-${nodeId}`, { finalAnswer })!;
    this.deferred.get(nodeId)!.resolve(completed);
  }

  fail(nodeId: string, error: string): void {
    const failed = this.repository.markFailed(`child-${nodeId}`, error)!;
    this.deferred.get(nodeId)!.resolve(failed);
  }
}

function node(id: string, task: string, dependsOn: string[] = []) {
  return {
    id,
    agent: "reviewer",
    task,
    dependsOn,
    workspaceAccess: AgentChildWorkspaceAccessModes.ReadOnly,
  };
}

function workflowContext(): AgentDelegationContext {
  return {
    parentSessionId: "parent-session",
    parentRequestId: "parent-request",
    approvalMode: AgentExecutionApprovalModes.Agent,
    authorizedToolNames: [],
    registry: { getTool: () => undefined },
  };
}
