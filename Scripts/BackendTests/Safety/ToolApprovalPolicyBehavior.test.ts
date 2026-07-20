import type { PolicyClient } from "@ai-sdk/policy-opa";
import { describe, expect, test, vi } from "vitest";
import {
  ToolRiskAuditDecision,
  ToolRiskLevel,
  type ToolRiskAudit,
} from "../../../Source/AgentSystem/BamlClient/baml_client/index.js";
import { AgentBamlToolRiskAuditor } from "../../../Source/AgentSystem/Safety/AgentBamlToolRiskAuditor.js";
import {
  AgentCompositeToolApprovalPolicy,
  type AgentToolApprovalPolicyInput,
} from "../../../Source/AgentSystem/Safety/AgentToolApprovalPolicy.js";
import type { AgentToolGuardrailAuditor } from "../../../Source/AgentSystem/Safety/AgentToolGuardrailAudit.js";

describe("tool approval policy composition", () => {
  test("projects a semantic deny into explicit user approval", async () => {
    const auditor = bamlAuditor({
      decision: ToolRiskAuditDecision.Deny,
      riskLevel: ToolRiskLevel.Critical,
      confidence: 0.98,
      tripwire: true,
      reason: "The command exposes a credential.",
      matchedConcerns: ["secret-exposure"],
      safeAlternative: null,
    });

    await expect(auditor.auditToolCall(toolInput())).resolves.toMatchObject({
      action: "ask",
      rule: "baml-tool-risk.deny.requires-approval",
      reason: "The command exposes a credential.",
      riskSignals: expect.arrayContaining([
        "baml.decision:Deny",
        "baml.riskLevel:Critical",
        "baml.concern:secret-exposure",
      ]),
    });
  });

  test("does not let a semantic approval path bypass a deterministic denial", async () => {
    const auditToolCall = vi.fn<AgentToolGuardrailAuditor["auditToolCall"]>(async () => ({
      action: "ask",
      rule: "semantic.ask",
      reason: "Confirm the semantic risk.",
      riskSignals: ["semantic:risk"],
    }));
    const policy = new AgentCompositeToolApprovalPolicy({
      auditors: [{ auditToolCall }],
      opa: {
        client: policyClient({
          decision: "deny",
          reason: "The manifest forbids this tool.",
          rule: "tool.manifest.deny",
          riskSignals: ["hard:deny"],
        }),
        path: "senera/tool/decision",
      },
    });

    await expect(policy.decideToolCall(toolInput())).resolves.toMatchObject({
      action: "deny",
      rule: "opa.tool.manifest.deny",
      reason: "The manifest forbids this tool.",
      riskSignals: expect.arrayContaining(["hard:deny"]),
    });
    expect(auditToolCall).not.toHaveBeenCalled();
  });

  test("keeps semantic risk approvable when deterministic policy allows execution", async () => {
    const policy = new AgentCompositeToolApprovalPolicy({
      auditors: [
        bamlAuditor({
          decision: ToolRiskAuditDecision.Deny,
          riskLevel: ToolRiskLevel.Critical,
          confidence: 0.96,
          tripwire: true,
          reason: "The command includes a user-provided credential.",
          matchedConcerns: ["secret-exposure"],
          safeAlternative: null,
        }),
      ],
      opa: {
        client: policyClient({
          decision: "allow",
          reason: "Deterministic boundaries allow this call.",
          rule: "runtime.allow",
          riskSignals: ["boundary:verified"],
        }),
        path: "senera/tool/decision",
      },
    });

    await expect(policy.decideToolCall(toolInput())).resolves.toMatchObject({
      action: "ask",
      rule: "baml-tool-risk.deny.requires-approval",
      reason: "The command includes a user-provided credential.",
      riskSignals: expect.arrayContaining(["boundary:verified", "baml.concern:secret-exposure"]),
    });
  });
});

function bamlAuditor(audit: ToolRiskAudit): AgentBamlToolRiskAuditor {
  return new AgentBamlToolRiskAuditor({
    client: {
      async auditToolRisk() {
        return audit;
      },
    },
  });
}

function policyClient(result: Record<string, unknown>): PolicyClient {
  return {
    async evaluate() {
      return result as never;
    },
  };
}

function toolInput(): AgentToolApprovalPolicyInput {
  return {
    sessionId: "session",
    requestId: "request",
    toolCallId: "call",
    step: 1,
    toolName: "ShellCommandTool",
    arguments: { command: "example" },
    visibleToolNames: "all",
    tool: {
      pluginName: "AgentShellToolPlugin",
      pluginTitle: "Shell",
      rootKind: "System",
      approval: { Mode: "allow" },
      permissions: ["process:shell"],
      capabilityRisks: [],
      capabilityEffects: [],
      security: {
        TrustLevel: "System",
        RequiresApproval: false,
      },
    },
  };
}
