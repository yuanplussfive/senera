import fs from "node:fs";
import path from "node:path";
import {
  guardrailApproval,
  parameterLengthGuardrail,
  pathTraversalGuardrail,
  sqlInjectionGuardrail,
  type GuardrailApprovalFunction,
  type GuardrailApprovalOptions,
  type ToolValidationResult,
} from "ai-sdk-guardrails";
import { moduleDirPath } from "../Core/AgentPath.js";
import { AgentPermissionActions, type AgentPermissionDecision } from "./AgentSafetyTypes.js";
import type { AgentToolApprovalPolicyInput } from "./AgentToolApprovalPolicy.js";
import type { AgentToolGuardrailAuditor } from "./AgentToolGuardrailAudit.js";

const ProfileFileName = "AgentAiSdkGuardrailAuditProfile.json";

type AiSdkGuardrailAuditDecision = Exclude<AgentPermissionDecision["action"], "allow">;
type AiSdkBuiltInToolGuardrail =
  | ReturnType<typeof pathTraversalGuardrail>
  | ReturnType<typeof sqlInjectionGuardrail>
  | ReturnType<typeof parameterLengthGuardrail>;
type AiSdkGuardrailApprovalStatus = Awaited<ReturnType<GuardrailApprovalFunction>>;
type NormalizedAiSdkGuardrailApprovalStatus = {
  readonly type: "approved" | "denied" | "user-approval" | "not-applicable";
  readonly reason?: string;
};

interface AgentAiSdkGuardrailAuditProfile {
  readonly ToolApproval: {
    readonly OnBlock?: GuardrailApprovalOptions["onBlock"];
    readonly DenyAtOrAbove?: GuardrailApprovalOptions["denyAtOrAbove"];
  };
  readonly BuiltInToolGuardrails: readonly AgentAiSdkBuiltInToolGuardrailSpec[];
}

type AgentAiSdkBuiltInToolGuardrailSpec =
  | {
      readonly Kind: "PathTraversal";
    }
  | {
      readonly Kind: "SqlInjection";
    }
  | {
      readonly Kind: "ParameterLength";
      readonly MaxLength?: number;
    };

interface AgentGuardrailDecisionTrace {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly status: AiSdkGuardrailApprovalStatus;
  readonly guardrail?: string;
  readonly result?: ToolValidationResult;
}

type BuiltInGuardrailFactory = (spec: AgentAiSdkBuiltInToolGuardrailSpec) => AiSdkBuiltInToolGuardrail;

const BuiltInGuardrailFactories = {
  PathTraversal: () => pathTraversalGuardrail(),
  SqlInjection: () => sqlInjectionGuardrail(),
  ParameterLength: (spec) =>
    parameterLengthGuardrail({
      maxLength: spec.Kind === "ParameterLength" ? spec.MaxLength : undefined,
    }),
} satisfies Record<AgentAiSdkBuiltInToolGuardrailSpec["Kind"], BuiltInGuardrailFactory>;

const ApprovalActionByStatus: Partial<
  Record<NormalizedAiSdkGuardrailApprovalStatus["type"], AiSdkGuardrailAuditDecision>
> = {
  denied: AgentPermissionActions.Deny,
  "user-approval": AgentPermissionActions.Ask,
};

export interface AgentAiSdkGuardrailAuditorOptions {
  readonly profile?: AgentAiSdkGuardrailAuditProfile;
}

export class AgentAiSdkGuardrailAuditor implements AgentToolGuardrailAuditor {
  private readonly profile: AgentAiSdkGuardrailAuditProfile;
  private readonly guardrails: AiSdkBuiltInToolGuardrail[];

  constructor(options: AgentAiSdkGuardrailAuditorOptions = {}) {
    this.profile = options.profile ?? readDefaultProfile();
    this.guardrails = this.profile.BuiltInToolGuardrails.map((spec) => BuiltInGuardrailFactories[spec.Kind](spec));
  }

  async auditToolCall(input: AgentToolApprovalPolicyInput): Promise<AgentPermissionDecision | undefined> {
    let trace: AgentGuardrailDecisionTrace | undefined;
    const approval = guardrailApproval(this.guardrails, {
      denyAtOrAbove: this.profile.ToolApproval.DenyAtOrAbove,
      onBlock: this.profile.ToolApproval.OnBlock,
      requestContext: projectRequestContext(input),
      onDecision: (decisionTrace) => {
        trace = decisionTrace;
      },
    });
    const status = normalizeApprovalStatus(
      await approval({
        toolCall: {
          toolName: input.toolName,
          toolCallId: input.toolCallId ?? toolCallIdForInput(input),
          input: input.arguments,
        },
      }),
    );
    const action = ApprovalActionByStatus[status.type];

    return action
      ? {
          action,
          rule: `ai-sdk-guardrails.${trace?.guardrail ?? status.type}`,
          reason: readDecisionReason(status, trace),
          riskSignals: riskSignals(status, trace),
        }
      : undefined;
  }
}

export function createAgentAiSdkGuardrailAuditor(): AgentAiSdkGuardrailAuditor {
  return new AgentAiSdkGuardrailAuditor();
}

function projectRequestContext(input: AgentToolApprovalPolicyInput): Record<string, unknown> {
  return {
    requestId: input.requestId,
    step: input.step,
    toolName: input.toolName,
    toolPermissions: input.tool?.permissions ?? [],
    visibleToolNames: input.visibleToolNames,
    runtimeContext: input.runtimeContext,
  };
}

function readDecisionReason(
  status: NormalizedAiSdkGuardrailApprovalStatus,
  trace: AgentGuardrailDecisionTrace | undefined,
): string {
  return status.reason
    ? status.reason
    : (trace?.result?.message ?? `工具调用触发 ${trace?.guardrail ?? "AI SDK Guardrails"} 审计。`);
}

function riskSignals(
  status: NormalizedAiSdkGuardrailApprovalStatus,
  trace: AgentGuardrailDecisionTrace | undefined,
): string[] {
  return [
    `guardrail.status:${status.type}`,
    ...(trace?.guardrail ? [`guardrail.name:${trace.guardrail}`] : []),
    ...(trace?.result?.severity ? [`guardrail.severity:${trace.result.severity}`] : []),
  ];
}

function normalizeApprovalStatus(status: AiSdkGuardrailApprovalStatus): NormalizedAiSdkGuardrailApprovalStatus {
  return typeof status === "string"
    ? { type: status }
    : {
        type: status?.type ?? "not-applicable",
        reason: status && "reason" in status ? status.reason : undefined,
      };
}

function toolCallIdForInput(input: AgentToolApprovalPolicyInput): string {
  return [input.requestId, input.step, input.toolName].join(":");
}

function readDefaultProfile(): AgentAiSdkGuardrailAuditProfile {
  return JSON.parse(
    fs.readFileSync(path.join(moduleDirPath(import.meta.url), ProfileFileName), "utf8"),
  ) as AgentAiSdkGuardrailAuditProfile;
}
