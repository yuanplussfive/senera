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
