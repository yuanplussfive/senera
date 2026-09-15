import { z } from "zod";
import {
  defineSystemTool,
  systemToolExecutionResult,
  type AgentSystemToolDefinition,
} from "./AgentSystemToolDefinition.js";
import { StandardAgentToolObservationProjection } from "../ToolRuntime/AgentToolObservationProjectionPlan.js";
import {
  AgentHostToolProtocolVersion,
  ToolResultAssessmentPolicies,
  ToolSchedulingModes,
} from "../Types/AgentToolContractTypes.js";
import type { AgentSelfServicePort } from "../SelfService/AgentSelfServiceTypes.js";
import {
  executeAgentSelfInvocation,
  projectAgentSelfInvocationValidationFailure,
} from "../SelfService/AgentSelfCommand.js";
import { AgentSelfInvocationSchema } from "../SelfService/AgentSelfCommandSchema.js";
import type {
  AgentSelfApprovalRequest,
  AgentSelfCommandExecutionOptions,
} from "../SelfService/AgentSelfApprovalTypes.js";
import type { AgentApprovalTransport } from "../SelfService/AgentApprovalTransport.js";
import type { AgentApprovalRuntime } from "../Approvals/AgentApprovalRuntime.js";
import { AgentApprovalDecisions, AgentApprovalKinds } from "../Approvals/AgentApprovalTypes.js";
import { AgentExecutionApprovalModes, type AgentExecutionApprovalMode } from "../Safety/AgentExecutionApprovalMode.js";
import { createOpaqueId } from "../Core/AgentIds.js";
import type { AgentHostToolContext } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { agentSelfCommandId, listAgentSelfCommandSpecs } from "../SelfService/AgentSelfCommandRegistry.js";
import { AgentEventKinds } from "../Events/AgentEvent.js";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";
import { readAgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import type { AgentToolProcessError } from "../Types/ToolRuntimeTypes.js";

const SelfApprovalCommandProjectionSchema = z
  .object({
    command: z.string().min(1),
    action: z.string().min(1).optional(),
  })
  .passthrough();

const SelfCommandOutputSchema = z
  .object({
    ok: z.boolean(),
    text: z.string(),
    data: z.unknown().optional(),
    error: z.string().min(1).optional(),
    approvalRequired: z
      .object({
        approvalId: z.string().min(1),
        command: SelfApprovalCommandProjectionSchema,
        reason: z.string().min(1),
        deadlineAt: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * Host-owned `senera` command surface: config inspection and controlled
 * updates, preset management, workspace metadata, and local health checks.
 * The tool introduces no shell indirection — every subcommand executes the
 * same implementation the human-facing CLI uses, through the live host
 * services, so config changes are revision-guarded, mirrored, and broadcast.
 *
 * Sensitive config updates are adjudicated per the session approval mode:
 * `full_access` and `agent` proceed (guardrail-trusted), `always_ask` opens
 * the frontend approval card via the runtime approval service.
 */
export function createSeneraSelfSystemTools(
  selfService?: AgentSelfServicePort,
  approvalRuntime?: AgentApprovalRuntime,
): readonly AgentSystemToolDefinition[] {
  const commandSpecs = listAgentSelfCommandSpecs();
  const commandActions = commandSpecs.map((spec) => agentSelfCommandId(spec.command, spec.action));
  const executeSelfCommand = async (
    input: z.output<typeof AgentSelfInvocationSchema>,
    context: AgentHostToolContext,
  ) => {
    if (!selfService) {
      return SelfCommandOutputSchema.parse({
        ok: false,
        text: "Senera 自服务当前未绑定到此运行时，命令未执行；请先启用主机自服务。",
        error: "self_service_unavailable",
        data: { availability: "unbound" },
      });
    }
    const options: AgentSelfCommandExecutionOptions = approvalRuntime
      ? {
          approvals: createModelCardApprovalTransport(approvalRuntime, context),
          approvalMode: context.approvalMode,
        }
      : {};
    const boundInput = bindSessionModelInvocation(input, context.sessionId);
    const output = await executeAgentSelfInvocation(boundInput, selfService, options);
    if (isSessionModelInvocation(boundInput) && boundInput.operation === "set") {
      const targetSessionId = boundInput.sessionId;
      const snapshot = targetSessionId ? selfService.sessions?.snapshot(targetSessionId) : undefined;
      if (snapshot) {
        await context.onEvent?.({
          kind: AgentEventKinds.SessionSnapshot,
          context: { sessionId: targetSessionId!, requestId: context.requestId },
          data: snapshot,
        });
      }
    }
    return SelfCommandOutputSchema.parse(output);
  };
  return [
    defineSystemTool({
      extension: {
        name: "senera-self",
        displayName: {
          "zh-CN": "Senera 自服务",
          "en-US": "Senera Self-Service",
        },
        description: {
          "zh-CN": "受控的命令面：查看和更新配置、管理预设与 Skill、检查工作区与系统状态。",
          "en-US":
            "Controlled command surface: inspect and update configuration, manage presets and Skills, and check workspace and system health.",
        },
        priority: 2,
        skills: ["senera-workbench"],
      },
      metadata: {
        observation: StandardAgentToolObservationProjection,
        description:
          "Executes the live Senera self-service command surface. The input schema is authoritative for command/action and parameter shapes; call capabilities for the live registry and governance workflow. Config and workspace Skill mutations are revision-guarded, validated, broadcast live where applicable, and adjudicated per the session approval mode. Skill reads are source-bounded; Skill writes can only target the unique workspace Skill source and retain restorable revisions. The human senera CLI and this tool share one executor.",
        permissions: [
          "config:read",
          "config:update",
          "preset:manage",
          "skills:read",
          "skills:manage",
          "workspace:inspect",
          "diagnostics:read",
        ],
        execution: { Targets: ["Local"], Network: "Deny", Workspace: "ReadWrite" },
        runtime: {
          Lifecycle: "Immediate",
          ProtocolVersion: AgentHostToolProtocolVersion,
          ResultAssessment: ToolResultAssessmentPolicies.ProcessExit,
          Scheduling: ToolSchedulingModes.Parallel,
          MaxConcurrency: 8,
        },
        search: {
          Summary: "受控执行 senera 配置、预设、Skill、工作区与诊断命令。",
          Tags: ["配置", "预设", "Skill", "工作区", "诊断", "模型", "doctor", "config", "preset", "skills", "pipeline"],
          Capabilities: [
            {
              Id: "senera.self",
              Title: "Senera self-service",
              Description:
                "Inspect or update the runtime configuration, list/activate presets, and read workspace/health metadata through the host command surface.",
              Facets: {
                Actions: [...commandActions],
                Targets: ["configuration", "preset", "skill", "workspace", "runtime", "session", "log"],
                Inputs: [
                  "command",
                  "path",
                  "name",
                  "value",
                  "content",
                  "revision",
                  "operation",
                  "modelProviderId",
                  "sessionId",
                ],
                Outputs: [
                  "config-snapshot",
                  "preset-summary",
                  "workspace-info",
                  "session-model-preference",
                  "effective-model-receipt",
                  "skill-catalog",
                  "skill-inspection",
                  "skill-diagnostics",
                  "doctor-report",
                  "capability-report",
                ],
                Effects: ["runtime-refresh", "config-change", "preset-change"],
              },
              Aliases: ["查看配置", "切换预设", "换模型", "查看工作区", "诊断", "senera 命令", "改配置"],
              Risk: { SideEffect: "runtime-refresh", Permission: "write" },
            },
          ],
          UseCases: [
            "用户要求查看或切换当前配置、模型端点、预设，查看、校验或受控维护 Skill，或检查系统与工作区状态。",
            "任务需要了解运行环境（工作区根目录、数据库、沙箱状态）时。",
          ],
          Examples: [
            "看看现在的模型配置",
            "切换到我昨天创建的前端专家预设",
            "当前配置里默认模型是什么",
            "把当前对话切换到另一个已配置模型",
            "帮我检查一下系统状态",
            "列出当前可用的 Skill 并检查是否有效",
            "把这次确认过的工作规则保存成工作区 Skill",
          ],
          Avoid: [
            "不要用它直接读取用户文档或代码文件；用工作区工具。",
            "不要在工具中执行任意 shell 命令。",
            "不要用 skills inspect 绕过来源和校验读取任意路径。",
            "不要修改系统 Skill；系统来源只读。",
            "不要在没有用户确认的情况下把临时猜测写成长期 Skill。",
          ],
        },
      },
      name: "SeneraCommand",
      input: AgentSelfInvocationSchema,
      output: SelfCommandOutputSchema,
      projectInvalidInput: (input, error) =>
        projectSeneraSelfFailure(
          SelfCommandOutputSchema.parse(projectAgentSelfInvocationValidationFailure(input, error.issues)),
        ),
      execute: executeSelfCommand,
      executeWithArtifacts: async (input, context) => {
        const output = await executeSelfCommand(input, context);
        return output.ok
          ? systemToolExecutionResult(output)
          : systemToolExecutionResult(output, { failure: projectSeneraSelfFailure(output) });
      },
    }),
  ];
}

function projectSeneraSelfFailure(output: z.output<typeof SelfCommandOutputSchema>): AgentToolProcessError {
  const data = readAgentUnknownRecord(output.data);
  const issues = Array.isArray(data?.issues)
    ? data.issues.flatMap((value) => {
        const issue = readAgentUnknownRecord(value);
        if (!issue || typeof issue.message !== "string") return [];
        const path = Array.isArray(issue.path) ? issue.path.map(String) : undefined;
        return [
          {
            message: issue.message,
            ...(typeof issue.code === "string" ? { code: issue.code } : {}),
            ...(typeof issue.pointer === "string" ? { pointer: issue.pointer } : {}),
            ...(path ? { path } : {}),
          },
        ];
      })
    : [];
  return {
    code:
      output.error === "invalid_command"
        ? AgentExecutionErrorCodes.InvalidToolArguments
        : AgentExecutionErrorCodes.ToolExecutionError,
    message: output.text,
    details: {
      phase: AgentToolProcessErrorPhases.RuntimeExecution,
      toolName: "SeneraCommand",
      ...(output.error ? { selfServiceError: output.error } : {}),
    },
    ...(issues.length > 0 ? { diagnostics: issues.slice(0, 8) } : {}),
  };
}

function bindSessionModelInvocation(
  input: z.input<typeof AgentSelfInvocationSchema>,
  sessionId: string | undefined,
): z.input<typeof AgentSelfInvocationSchema> {
  if (!isSessionModelInvocation(input)) return input;
  const bound = sessionId?.trim();
  if (!bound) throw new Error("Senera session model requires an active session context.");
  if (input.sessionId && input.sessionId !== bound) {
    throw new Error("Senera session model may only target the active model session.");
  }
  return { ...input, sessionId: bound } as z.input<typeof AgentSelfInvocationSchema>;
}

type SessionModelInvocation = Extract<
  z.input<typeof AgentSelfInvocationSchema>,
  { command: "session"; action: "model" }
>;

function isSessionModelInvocation(input: z.input<typeof AgentSelfInvocationSchema>): input is SessionModelInvocation {
  return input.command === "session" && input.action === "model" && "operation" in input;
}

const SelfApprovalDeadlineMs = 120_000;

/**
 * Built-in model-facing approval transport: opens the frontend approval card
 * through the runtime approval service. Like the CLI terminal transport, it
 * satisfies `AgentApprovalTransport`, so executors keep a single adjudication
 * path while presentation stays transport-specific. Bound per tool invocation
 * because it captures session/request context, unlike the registrable `http`
 * transport.
 */
function createModelCardApprovalTransport(
  approvalRuntime: AgentApprovalRuntime,
  context: AgentHostToolContext,
): AgentApprovalTransport {
  return {
    name: "model-card",
    kind: "model-card",
    async request(input: AgentSelfApprovalRequest) {
      const resolved = resolveToolApprovalDisposition(input.mode);
      if (resolved) return resolved;
      const isSkill = input.kind === "skill";
      const resolution = await approvalRuntime.requestApproval({
        approval: {
          kind: AgentApprovalKinds.ToolCall,
          sessionId: context.sessionId ?? "senera-self",
          requestId: context.requestId ?? createOpaqueId("self_approval"),
          step: context.step ?? 0,
          toolCallId: context.toolCallId,
          title: isSkill ? `Skill 变更: ${input.skillName}` : `敏感配置修改: ${input.path}`,
          reason: isSkill ? input.reason : input.rule.reason,
          rule: isSkill ? `skill.${input.operation}` : input.rule.pattern,
          riskSignals: [isSkill ? "workspace-skill-mutation" : "sensitive-config-path"],
          availableDecisions: [AgentApprovalDecisions.ApproveOnce, AgentApprovalDecisions.Deny],
          subject: {
            kind: AgentApprovalKinds.ToolCall,
            toolName: "SeneraCommand",
            arguments: { ...input.command },
          },
        },
        onEvent: context.onEvent,
        signal: context.signal,
        deadlineMs: SelfApprovalDeadlineMs,
      });
      if (resolution.status === "approved") return { status: "approved" };
      return {
        status: "denied",
        message: resolution.message ?? "敏感配置修改未获批准。",
      };
    },
  };
}

/** Mirrors the execution approval pipeline: full_access and agent both project
 * Ask -> Allow, so the self-service channel proceeds without a card the user
 * already opted out of. always_ask (and unset modes) open the card. */
export function resolveToolApprovalDisposition(
  mode: AgentExecutionApprovalMode | undefined,
): { readonly status: "approved" } | undefined {
  if (mode === AgentExecutionApprovalModes.FullAccess || mode === AgentExecutionApprovalModes.Agent) {
    return { status: "approved" };
  }
  return undefined;
}
