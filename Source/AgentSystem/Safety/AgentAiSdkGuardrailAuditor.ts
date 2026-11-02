import fs from "node:fs";
import path from "node:path";
import type { GuardrailApprovalFunction, GuardrailApprovalOptions, ToolValidationResult } from "ai-sdk-guardrails";
import { moduleDirPath } from "../Core/AgentPath.js";
import { AgentPermissionActions, type AgentPermissionDecision } from "./AgentSafetyTypes.js";
import type { AgentToolApprovalPolicyInput } from "./AgentToolApprovalPolicy.js";
import type { AgentToolGuardrailAuditor } from "./AgentToolGuardrailAudit.js";
import { parseJsonText } from "../Core/AgentJsonParsing.js";

const ProfileFileName = "AgentAiSdkGuardrailAuditProfile.json";

type AiSdkGuardrailAuditDecision = Exclude<AgentPermissionDecision["action"], "allow">;
type AiSdkGuardrailsModuleType = typeof import("ai-sdk-guardrails");
type AiSdkBuiltInToolGuardrail =
  | ReturnType<AiSdkGuardrailsModuleType["pathTraversalGuardrail"]>
  | ReturnType<AiSdkGuardrailsModuleType["sqlInjectionGuardrail"]>
  | ReturnType<AiSdkGuardrailsModuleType["parameterLengthGuardrail"]>;
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

type BuiltInGuardrailFactory = (
  module: AiSdkGuardrailsModuleType,
  spec: AgentAiSdkBuiltInToolGuardrailSpec,
) => AiSdkBuiltInToolGuardrail;

type AiSdkGuardrailsModule = AiSdkGuardrailsModuleType;

let guardrailsModulePromise: Promise<AiSdkGuardrailsModule> | undefined;

function loadAiSdkGuardrails(): Promise<AiSdkGuardrailsModule> {
  // ai-sdk-guardrails pulls in the full `ai` package (~1MB of retained module
  // source); keep it out of the startup heap until the first tool audit.
  guardrailsModulePromise ??= import("ai-sdk-guardrails");
  return guardrailsModulePromise;
}

const BuiltInGuardrailFactories = {
  PathTraversal: (m) => m.pathTraversalGuardrail(),
  SqlInjection: (m) => m.sqlInjectionGuardrail(),
  ParameterLength: (m, spec) =>
    m.parameterLengthGuardrail({
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
  private guardrailsPromise: Promise<AiSdkBuiltInToolGuardrail[]> | undefined;

  constructor(options: AgentAiSdkGuardrailAuditorOptions = {}) {
    this.profile = options.profile ?? readDefaultProfile();
  }

  async auditToolCall(input: AgentToolApprovalPolicyInput): Promise<AgentPermissionDecision | undefined> {
    const [module, guardrails] = await Promise.all([loadAiSdkGuardrails(), this.ensureGuardrails()]);
    let trace: AgentGuardrailDecisionTrace | undefined;
    const approval = module.guardrailApproval(guardrails, {
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

  private ensureGuardrails(): Promise<AiSdkBuiltInToolGuardrail[]> {
    this.guardrailsPromise ??= loadAiSdkGuardrails().then((module) =>
      this.profile.BuiltInToolGuardrails.map((spec) => BuiltInGuardrailFactories[spec.Kind](module, spec)),
    );
    return this.guardrailsPromise;
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
    toolAccessGrant: input.toolAccessGrant,
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
  return parseJsonText(
    fs.readFileSync(path.join(moduleDirPath(import.meta.url), ProfileFileName), "utf8"),
    "AI SDK guardrail audit profile",
  ) as AgentAiSdkGuardrailAuditProfile;
}
