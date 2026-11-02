import type {
  AgentSelfCommandOutput,
  AgentSelfInvocation,
  AgentSelfServicePort,
} from "../SelfService/AgentSelfServiceTypes.js";
import { executeAgentSelfInvocation } from "../SelfService/AgentSelfCommand.js";
import {
  AgentSelfCommandModelBindings,
  resolveAgentSelfCommandModelBinding,
} from "../SelfService/AgentSelfCommandRegistry.js";
import type {
  AgentSelfApprovalRequest,
  AgentSelfCommandExecutionOptions,
} from "../SelfService/AgentSelfApprovalTypes.js";
import type { AgentApprovalTransport } from "../SelfService/AgentApprovalTransport.js";
import type { AgentApprovalRuntime } from "../Approvals/AgentApprovalRuntime.js";
import { AgentApprovalDecisions, AgentApprovalKinds } from "../Approvals/AgentApprovalTypes.js";
import { AgentExecutionApprovalModes, type AgentExecutionApprovalMode } from "../Safety/AgentExecutionApprovalMode.js";
import type { AgentHostToolContext } from "../ToolRuntime/AgentToolHostCapabilityRegistry.js";
import { AgentEventKinds } from "../Events/AgentEvent.js";
import { formatAgentTimeDisplay } from "../Time/AgentTime.js";
import { agentMemorySubject } from "../Continuity/AgentMemoryLearningLedger.js";

export type AgentSelfModelOutput = Omit<AgentSelfCommandOutput, "model"> & { readonly revision?: string };
type ModelInvocation = AgentSelfInvocation;

/** The CLI and HTTP adapter use the same session binding, approvals and executor. */
export function createAgentSelfModelExecutor(
  selfService: AgentSelfServicePort,
  approvalRuntime?: AgentApprovalRuntime,
): (input: AgentSelfInvocation, context: AgentHostToolContext) => Promise<AgentSelfModelOutput> {
  return async (input, context) => {
    context.signal?.throwIfAborted();
    if (input.command === "approval") {
      return {
        ok: false,
        text: "Model commands cannot resolve their own approvals.",
        error: "approval_self_resolution_denied",
      };
    }
    const options: AgentSelfCommandExecutionOptions = approvalRuntime
      ? { approvals: createModelCardApprovalTransport(approvalRuntime, context), approvalMode: context.approvalMode }
      : { approvalMode: context.approvalMode };
    const boundInput = bindSessionAgentInvocation(
      bindSessionModelInvocation(input, context.sessionId),
      context,
      selfService,
    );
    const scopedService = selfService.diaries?.forSubject
      ? { ...selfService, diaries: selfService.diaries.forSubject(agentMemorySubject(context.interaction).id) }
      : selfService;
    const output = await executeAgentSelfInvocation(boundInput, scopedService, options);
    if (output.ok && isSessionModelInvocation(boundInput) && boundInput.operation === "set") {
      const snapshot = selfService.sessions?.snapshot(boundInput.sessionId!);
      if (snapshot)
        await context.onEvent?.({
          kind: AgentEventKinds.SessionSnapshot,
          context: { sessionId: boundInput.sessionId!, requestId: context.requestId },
          data: snapshot,
        });
    }
    return projectAgentSelfModelOutput(
      output.approvalRequired
        ? {
            ...output,
            approvalRequired: {
              ...output.approvalRequired,
              deadlineAt: formatAgentTimeDisplay(output.approvalRequired.deadlineAt),
            },
          }
        : output,
    );
  };
}

/** Producers declare their model slice; transports never guess which fields matter. */
export function projectAgentSelfModelOutput(output: AgentSelfCommandOutput): AgentSelfModelOutput {
  const { model, data, ...rest } = output;
  if (!model) return data === undefined ? rest : { ...rest, data };
  const projected = model.data === undefined ? rest : { ...rest, data: model.data };
  return model.revision ? { ...projected, revision: model.revision } : projected;
}

function bindSessionModelInvocation(input: ModelInvocation, sessionId: string | undefined): ModelInvocation {
  if (!isSessionModelInvocation(input)) return input;
  const bound = sessionId?.trim();
  if (!bound) throw new Error("Senera session model requires an active session context.");
  if (input.sessionId && input.sessionId !== bound) {
    throw new Error("Senera session model may only target the active model session.");
  }
  return { ...input, sessionId: bound };
}

function bindSessionAgentInvocation(
  input: ModelInvocation,
  context: AgentHostToolContext,
  service: AgentSelfServicePort,
): ModelInvocation {
  if (resolveAgentSelfCommandModelBinding(input) !== AgentSelfCommandModelBindings.ActiveSessionAgent) return input;
  const sessionId = context.sessionId?.trim();
  const agentId = sessionId ? service.sessions?.resolveAgentId(sessionId) : undefined;
  if (!agentId) throw new Error("Senera Agent operations require an active session Agent.");
  const requestedAgentId = "agentId" in input ? input.agentId : undefined;
  if (requestedAgentId && requestedAgentId !== agentId) {
    throw new Error("Senera Agent operations may only target the active session Agent.");
  }
  const bound = { ...input, agentId };
  return bound;
}

type SessionModelInvocation = Extract<AgentSelfInvocation, { command: "session"; action: "model" }>;

function isSessionModelInvocation(input: ModelInvocation): input is SessionModelInvocation {
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
      if (!context.sessionId || !context.requestId || context.step === undefined) {
        throw new Error("Model command approval requires a verified session, request and step.");
      }
      const resolution = await approvalRuntime.requestApproval({
        approval: {
          kind: AgentApprovalKinds.ToolCall,
          sessionId: context.sessionId,
          requestId: context.requestId,
          step: context.step,
          toolCallId: context.toolCallId,
          title: isSkill ? `Skill 变更: ${input.skillName}` : `敏感配置修改: ${input.path}`,
          reason: isSkill ? input.reason : input.rule.reason,
          rule: isSkill ? `skill.${input.operation}` : input.rule.pattern,
          riskSignals: [isSkill ? "workspace-skill-mutation" : "sensitive-config-path"],
          availableDecisions: [AgentApprovalDecisions.ApproveOnce, AgentApprovalDecisions.Deny],
          subject: {
            kind: AgentApprovalKinds.ToolCall,
            toolName: context.tool.name,
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
