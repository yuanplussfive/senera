import { describe, expect, test, vi } from "vitest";
import type { AgentApprovalRuntime } from "../../../Source/AgentSystem/Approvals/AgentApprovalRuntime.js";
import type { AgentApprovalWaitOptions } from "../../../Source/AgentSystem/Approvals/AgentApprovalTypes.js";
import {
  AgentExecutionApprovalModes,
  projectAgentExecutionApprovalDecision,
} from "../../../Source/AgentSystem/Safety/AgentExecutionApprovalMode.js";
import {
  AgentToolPermissionDeniedError,
  AgentToolPermissionGate,
} from "../../../Source/AgentSystem/Safety/AgentToolPermissionGate.js";
import {
  AgentPermissionActions,
  type AgentPermissionDecision,
} from "../../../Source/AgentSystem/Safety/AgentSafetyTypes.js";
import type {
  AgentToolApprovalEvaluationOptions,
  AgentToolApprovalPolicy,
} from "../../../Source/AgentSystem/Safety/AgentToolApprovalPolicy.js";
import { AgentSessionApprovalLeaseStore } from "../../../Source/AgentSystem/Safety/AgentSessionApprovalLeaseStore.js";
import { AgentToolSemanticAuditModes } from "../../../Source/AgentSystem/Types/AgentRuntimeConfigTypes.js";
import { toolAccessGrant } from "../Support/AgentTestFixtures.js";
import type { AgentResourceAccessPlan } from "../../../Source/AgentSystem/Execution/SeneraResourceAccess.js";

describe("execution approval modes", () => {
  test("projects policy decisions through the declared run mode", () => {
    expect(
      projectAgentExecutionApprovalDecision(
        decision(AgentPermissionActions.Allow),
        AgentExecutionApprovalModes.AlwaysAsk,
      ),
    ).toMatchObject({ action: AgentPermissionActions.Allow });
    expect(
      projectAgentExecutionApprovalDecision(decision(AgentPermissionActions.Ask), AgentExecutionApprovalModes.Agent),
    ).toMatchObject({ action: AgentPermissionActions.Allow });
    expect(
      projectAgentExecutionApprovalDecision(
        decision(AgentPermissionActions.Ask),
        AgentExecutionApprovalModes.FullAccess,
      ),
    ).toMatchObject({ action: AgentPermissionActions.Allow });
  });

  test.each(Object.values(AgentExecutionApprovalModes))("preserves policy denial in %s mode", async (approvalMode) => {
    const approvalRuntime = { requestApproval: vi.fn() } as unknown as AgentApprovalRuntime;
    const gate = new AgentToolPermissionGate({
      policy: policy(decision(AgentPermissionActions.Deny)),
      sessionApprovals: new AgentSessionApprovalLeaseStore(),
      approvalRuntime,
      toolPlanningMode: "native",
    });

    await expect(gate.authorize(request(approvalMode))).rejects.toBeInstanceOf(AgentToolPermissionDeniedError);
    expect(approvalRuntime.requestApproval).not.toHaveBeenCalled();
  });

  test("full access does not create an approval for a policy ask decision", async () => {
    const approvalRuntime = { requestApproval: vi.fn() } as unknown as AgentApprovalRuntime;
    const gate = new AgentToolPermissionGate({
      policy: policy(decision(AgentPermissionActions.Ask)),
      sessionApprovals: new AgentSessionApprovalLeaseStore(),
      approvalRuntime,
      toolPlanningMode: "native",
    });

    await expect(gate.authorize(request(AgentExecutionApprovalModes.FullAccess))).resolves.toMatchObject({
      action: AgentPermissionActions.Allow,
    });
    expect(approvalRuntime.requestApproval).not.toHaveBeenCalled();
  });

  test("always-ask obtains a call-bound grant before accessing an external host path", async () => {
    const requestApproval = vi.fn(async () => ({
      approvalId: "approval-external",
      decision: "approve_once" as const,
      status: "approved" as const,
      disposition: "proceed" as const,
      scope: "once" as const,
      resolvedAt: new Date().toISOString(),
    }));
    const gate = new AgentToolPermissionGate({
      policy: policy(decision(AgentPermissionActions.Allow)),
      sessionApprovals: new AgentSessionApprovalLeaseStore(),
      approvalRuntime: { requestApproval } as unknown as AgentApprovalRuntime,
      toolPlanningMode: "native",
    });

    const result = await gate.authorize({
      ...request(AgentExecutionApprovalModes.AlwaysAsk),
      resourceAccess: externalResourceAccess(),
    });

    expect(requestApproval).toHaveBeenCalledOnce();
    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        approval: expect.objectContaining({
          reason: "本次工具调用将访问工作区外的宿主路径，需要你的批准。",
          subject: expect.objectContaining({
            resources: [{ canonicalPath: expect.any(String), intent: "read", recursive: true }],
          }),
        }),
      }),
    );
    expect(result).toMatchObject({
      action: AgentPermissionActions.Allow,
      resourceGrant: {
        mode: "approved-host",
        resources: [{ canonicalPath: expect.any(String), intent: "read", recursive: true }],
        binding: {
          sessionId: "session-approval-mode",
          requestId: "request-approval-mode",
          toolCallId: "call-approval-mode",
          toolName: "TestTool",
        },
      },
    });
  });

  test("reuses a session approval only for the same external resource scope", async () => {
    const requestApproval = vi.fn(async () => ({
      approvalId: "approval-external-session",
      decision: "approve_session" as const,
      status: "approved" as const,
      disposition: "proceed" as const,
      scope: "session" as const,
      resolvedAt: new Date().toISOString(),
    }));
    const gate = new AgentToolPermissionGate({
      policy: policy(decision(AgentPermissionActions.Allow)),
      sessionApprovals: new AgentSessionApprovalLeaseStore(),
      approvalRuntime: { requestApproval } as unknown as AgentApprovalRuntime,
      toolPlanningMode: "native",
    });
    const first = { ...request(AgentExecutionApprovalModes.AlwaysAsk), resourceAccess: externalResourceAccess() };

    await gate.authorize(first);
    await expect(gate.authorize({ ...first, toolCallId: "call-external-second" })).resolves.toMatchObject({
      action: AgentPermissionActions.Allow,
      rule: expect.stringContaining("session_lease"),
      resourceGrant: { mode: "approved-host" },
    });
    expect(requestApproval).toHaveBeenCalledOnce();

    const otherScope = externalResourceAccess("C:/other-external");
    await gate.authorize({ ...first, toolCallId: "call-external-other", resourceAccess: otherScope });
    expect(requestApproval).toHaveBeenCalledTimes(2);
  });

  test.each([
    [AgentExecutionApprovalModes.Agent, "approved-host"],
    [AgentExecutionApprovalModes.FullAccess, "full-host"],
  ] as const)("%s authorizes external host access without user interaction", async (approvalMode, grantMode) => {
    const requestApproval = vi.fn();
    const gate = new AgentToolPermissionGate({
      policy: policy(decision(AgentPermissionActions.Ask)),
      sessionApprovals: new AgentSessionApprovalLeaseStore(),
      approvalRuntime: { requestApproval } as unknown as AgentApprovalRuntime,
      toolPlanningMode: "native",
    });

    await expect(
      gate.authorize({ ...request(approvalMode), resourceAccess: externalResourceAccess() }),
    ).resolves.toMatchObject({ action: AgentPermissionActions.Allow, resourceGrant: { mode: grantMode } });
    expect(requestApproval).not.toHaveBeenCalled();
  });

  test("does not mint a host grant for workspace-contained access", async () => {
    const gate = new AgentToolPermissionGate({
      policy: policy(decision(AgentPermissionActions.Allow)),
      sessionApprovals: new AgentSessionApprovalLeaseStore(),
      toolPlanningMode: "native",
    });

    await expect(
      gate.authorize({
        ...request(AgentExecutionApprovalModes.Agent),
        resourceAccess: { requests: [], external: [] },
      }),
    ).resolves.toMatchObject({ action: AgentPermissionActions.Allow, resourceGrant: undefined });
  });

  test("rejects an unresolvable external resource before policy evaluation or approval", async () => {
    const decideToolCall = vi.fn(async () => decision(AgentPermissionActions.Allow));
    const requestApproval = vi.fn();
    const gate = new AgentToolPermissionGate({
      policy: { decideToolCall },
      sessionApprovals: new AgentSessionApprovalLeaseStore(),
      approvalRuntime: { requestApproval } as unknown as AgentApprovalRuntime,
      toolPlanningMode: "native",
    });
    const resourceAccess = externalResourceAccess();
    const unresolved = {
      ...resourceAccess.external[0]!,
      canonicalPath: undefined,
      facts: { ...resourceAccess.external[0]!.facts, linkTraversal: "external" as const },
    };

    await expect(
      gate.authorize({
        ...request(AgentExecutionApprovalModes.FullAccess),
        resourceAccess: { requests: [unresolved], external: [unresolved] },
      }),
    ).rejects.toMatchObject({
      decision: { action: AgentPermissionActions.Deny, rule: "resource.external.unresolved" },
    });
    expect(decideToolCall).not.toHaveBeenCalled();
    expect(requestApproval).not.toHaveBeenCalled();
  });

  test.each([
    ["native", AgentExecutionApprovalModes.AlwaysAsk, AgentToolSemanticAuditModes.ApprovalSensitive, false],
    ["baml", AgentExecutionApprovalModes.AlwaysAsk, AgentToolSemanticAuditModes.ApprovalSensitive, true],
    ["baml", AgentExecutionApprovalModes.Agent, AgentToolSemanticAuditModes.ApprovalSensitive, false],
    ["baml", AgentExecutionApprovalModes.FullAccess, AgentToolSemanticAuditModes.ApprovalSensitive, false],
    ["baml", AgentExecutionApprovalModes.AlwaysAsk, AgentToolSemanticAuditModes.Disabled, false],
  ] as const)(
    "%s planning with %s approval and %s semantic auditing sets includeSemanticAuditors=%s",
    async (toolPlanningMode, approvalMode, semanticAuditMode, expected) => {
      const evaluations: Array<AgentToolApprovalEvaluationOptions | undefined> = [];
      const gate = new AgentToolPermissionGate({
        policy: {
          async decideToolCall(_input, evaluation) {
            evaluations.push(evaluation);
            return decision(AgentPermissionActions.Allow);
          },
        },
        sessionApprovals: new AgentSessionApprovalLeaseStore(),
        semanticAuditMode,
        toolPlanningMode,
      });

      await gate.authorize(request(approvalMode));

      expect(evaluations).toEqual([{ includeSemanticAuditors: expected }]);
    },
  );

  test("a session approval follows the declared capability across runtimes and is revoked with the session", async () => {
    const requestApproval = vi.fn(async (_options: AgentApprovalWaitOptions) => ({
      approvalId: "approval-session",
      decision: "approve_session" as const,
      status: "approved" as const,
      disposition: "proceed" as const,
      scope: "session" as const,
      resolvedAt: new Date().toISOString(),
    }));
    const sessionApprovals = new AgentSessionApprovalLeaseStore();
    const createGate = () =>
      new AgentToolPermissionGate({
        policy: policy(decision(AgentPermissionActions.Ask)),
        sessionApprovals,
        approvalRuntime: { requestApproval } as unknown as AgentApprovalRuntime,
        toolPlanningMode: "native",
      });
    const gate = createGate();

    await gate.authorize(request(AgentExecutionApprovalModes.AlwaysAsk));
    const nextRuntimeGate = createGate();
    await expect(
      nextRuntimeGate.authorize({
        ...request(AgentExecutionApprovalModes.AlwaysAsk),
        toolCallId: "call-second",
        arguments: { command: "different invocation of the same capability" },
      }),
    ).resolves.toMatchObject({ action: AgentPermissionActions.Allow, rule: expect.stringContaining("session_lease") });
    expect(requestApproval).toHaveBeenCalledTimes(1);

    sessionApprovals.revoke("session-approval-mode");
    await nextRuntimeGate.authorize({
      ...request(AgentExecutionApprovalModes.AlwaysAsk),
      toolCallId: "call-after-close",
    });
    expect(requestApproval).toHaveBeenCalledTimes(2);
    expect(requestApproval.mock.calls[0]?.[0].approval.availableDecisions).toContain("approve_session");
  });
});

function decision(action: AgentPermissionDecision["action"]): AgentPermissionDecision {
  return { action, rule: `test.${action}`, reason: `test ${action}`, riskSignals: [] } as AgentPermissionDecision;
}

function policy(result: AgentPermissionDecision): AgentToolApprovalPolicy {
  return { decideToolCall: vi.fn(async () => result) };
}

function request(approvalMode: (typeof AgentExecutionApprovalModes)[keyof typeof AgentExecutionApprovalModes]) {
  return {
    approvalMode,
    sessionId: "session-approval-mode",
    requestId: "request-approval-mode",
    toolCallId: "call-approval-mode",
    step: 1,
    toolName: "TestTool",
    arguments: {},
    toolAccessGrant: toolAccessGrant(["TestTool"], ["TestTool"]),
  };
}

function externalResourceAccess(canonicalPath = "C:/external"): AgentResourceAccessPlan {
  const request = {
    addressedPath: canonicalPath,
    canonicalPath,
    intent: "read" as const,
    recursive: true,
    facts: {
      scope: "workspace" as const,
      intent: "read" as const,
      authority: "tool" as const,
      domain: "workspace-content" as const,
      domainRoot: false,
      relativePath: "../external",
      containment: "outside" as const,
      linkTraversal: "none" as const,
      finalEntry: "directory" as const,
    },
  };
  return { requests: [request], external: [request] };
}
