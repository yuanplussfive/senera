import type { AgentExecutionResult } from "./AgentDecisionExecutor.js";
import type { AgentDecision, ExecutedToolCallResult } from "./Types/ToolRuntimeTypes.js";

/**
 * 精简档执行步骤轨迹：持久化后用于历史回放时重建前端执行图。
 * 只保留重建图所需的结构化字段，不含逐 token model.delta 与 prompt 计时。
 * toolArgs / toolResult / toolPreview 受体积红线约束（见 clampField）。
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
  callId?: string;
  status: "done" | "failed";
  startedAt?: string;
  endedAt?: string;
  title?: string;
  toolArgs?: unknown;
  toolPreview?: string;
  toolResult?: unknown;
  toolErrorMessage?: string;
  errorMessage?: string;
  retryCode?: string;
}

/** 单字段序列化后的字节上限，超出截断并标记。避免大对象 / 文件内容无限落盘。 */
const MAX_FIELD_BYTES = 4096;
const MAX_PREVIEW_CHARS = 240;

/** 把任意值约束到体积红线内：截断超大对象，保留可读摘要。 */
export function clampField(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") {
    return value.length > MAX_FIELD_BYTES
      ? `${value.slice(0, MAX_FIELD_BYTES)}…[truncated]`
      : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  try {
    const json = JSON.stringify(value);
    if (json.length > MAX_FIELD_BYTES) {
      return { __truncated: true, preview: `${json.slice(0, MAX_FIELD_BYTES)}…` };
    }
    return value;
  } catch {
    return undefined;
  }
}

function clampPreview(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > MAX_PREVIEW_CHARS
    ? `${normalized.slice(0, MAX_PREVIEW_CHARS)}…`
    : normalized;
}

/** ToolCalls 决策 → 决策节点（多步轮次的主干）。 */
export function buildDecisionTrace(
  step: number,
  seq: number,
  decision: AgentDecision,
): StepTrace {
  return {
    step,
    seq,
    kind: "decision",
    decisionKind: decision.kind,
    status: "done",
  };
}

/** 执行结果 → 工具节点（一次工具调用一条）。 */
export function buildToolTraces(
  step: number,
  startSeq: number,
  execution: Extract<AgentExecutionResult, { kind: "ToolResults" }>,
): StepTrace[] {
  const results: ExecutedToolCallResult[] = Array.isArray(execution.value) ? execution.value : [];
  return results.map((result, index) => {
    const failed = result.process.exitCode !== null && result.process.exitCode !== 0;
    return {
      step,
      seq: startSeq + index,
      kind: "tool",
      toolName: result.name,
      callId: result.callId,
      status: failed ? "failed" : "done",
      toolArgs: clampField(result.arguments),
      toolPreview: clampPreview(summarizeResult(result.result)),
      toolResult: clampField(result.result),
      toolErrorMessage: failed ? clampPreview(result.process.stderr) : undefined,
    };
  });
}

/** 终结节点：生成回复 / 向用户提问。 */
export function buildAnswerTrace(
  step: number,
  seq: number,
  decisionKind: "final_answer" | "ask_user",
): StepTrace {
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

function summarizeResult(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.preview === "string") return record.preview;
    if (typeof record.content === "string") return record.content;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}
