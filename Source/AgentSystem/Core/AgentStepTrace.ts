import type { AgentToolEventOrigin } from "../ToolRuntime/AgentToolEventOrigin.js";
import type { AgentToolResultPresentation } from "../Types/ToolRuntimeTypes.js";
import type { AgentJsonProjectionOmission } from "../Text/AgentBudgetedJsonProjection.js";

/**
 * 精简档执行步骤轨迹：持久化后用于历史回放时重建前端执行图。
 * 只保留重建图所需的结构化字段，不含逐 token model.delta 与 prompt 计时。
 * toolArgs / toolResult / toolPreview 受体积红线约束（见 projectAgentToolArguments）。
 *
 * 注意：状态机是纯转移函数、不产生时间戳，故 startedAt/endedAt 不在累积时填，
 * 由 manager 落盘时统一补 turn 级基准时间（精简档不承诺逐步精确计时）。
 */
export interface StepTrace {
  step: number;
  seq: number;
  kind: "decision" | "tool" | "retry" | "answer";
  decisionKind?: string;
  toolName?: string;
  toolOrigin?: AgentToolEventOrigin;
  callId?: string;
  batchId?: string;
  purpose?: string;
  status: "done" | "failed";
  startedAt?: string;
  endedAt?: string;
  title?: string;
  toolArgs?: unknown;
  /**
   * Rows dropped from `toolArgs` to stay within the byte ceiling, addressed by
   * RFC 6901 pointer. A sibling field rather than a wrapper, so the declared
   * pointers inside `toolArgs` keep resolving unchanged.
   */
  toolArgsOmissions?: readonly AgentJsonProjectionOmission[];
  toolPreview?: string;
  toolPresentation?: AgentToolResultPresentation;
  toolResult?: unknown;
  toolErrorMessage?: string;
  errorMessage?: string;
  retryCode?: string;
}

const MAX_PREVIEW_CHARS = 240;

function clampPreview(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > MAX_PREVIEW_CHARS ? `${normalized.slice(0, MAX_PREVIEW_CHARS)}…` : normalized;
}

/** 终结节点：生成回复 / 向用户提问。 */
export function buildAnswerTrace(step: number, seq: number, decisionKind: "final_answer" | "ask_user"): StepTrace {
  return {
    step,
    seq,
    kind: "answer",
    decisionKind,
    status: "done",
    title: decisionKind === "ask_user" ? "向用户提问" : "生成回复",
  };
}

/** 重试节点。 */
export function buildRetryTrace(
  step: number,
  seq: number,
  code: string | undefined,
  message: string | undefined,
): StepTrace {
  return {
    step,
    seq,
    kind: "retry",
    status: "failed",
    retryCode: code,
    errorMessage: clampPreview(message),
  };
}
