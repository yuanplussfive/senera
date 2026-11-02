import { readFiniteNumber, readNonEmptyString, readRequestHandle } from "./AgentEventDisplayValueReaders.js";

const NumberFormatter = new Intl.NumberFormat("zh-CN");

export function formatStepToken(value: unknown): string | undefined {
  const number = readFiniteNumber(value);
  return number === undefined ? undefined : `第${NumberFormatter.format(number)}步`;
}

export function formatCountToken(value: unknown, unit: string): string | undefined {
  const number = readFiniteNumber(value);
  return number === undefined ? undefined : `${NumberFormatter.format(number)}${unit}`;
}

export function formatToolCountToken(value: unknown): string | undefined {
  const number = readFiniteNumber(value);
  return number === undefined ? undefined : `${NumberFormatter.format(number)}个结果`;
}

export function formatTurnCountToken(value: unknown): string | undefined {
  const number = readFiniteNumber(value);
  return number === undefined ? undefined : `${NumberFormatter.format(number)}轮`;
}

export function formatEntryCountToken(value: unknown): string | undefined {
  const number = readFiniteNumber(value);
  return number === undefined ? undefined : `${NumberFormatter.format(number)}条记录`;
}

export function formatReasonToken(value: unknown): string | undefined {
  const reason = readNonEmptyString(value);
  return reason ? `原因 ${reason}` : undefined;
}

export function formatPlannerStageToken(value: unknown): string | undefined {
  const stage = readNonEmptyString(value);
  if (!stage) {
    return undefined;
  }

  const catalog: Record<string, string> = {
    understandUserTurn: "理解当前请求",
  };
  return catalog[stage] ?? stage;
}

export function formatInteractionModeToken(value: unknown): string | undefined {
  const mode = readNonEmptyString(value);
  if (!mode) {
    return undefined;
  }

  const catalog: Record<string, string> = {
    direct_response: "直接回复",
    tool_agent_loop: "工具循环",
  };
  return catalog[mode] ?? mode;
}

export function formatActiveRequestToken(value: unknown): string | undefined {
  const handle = readRequestHandle(value);
  return handle ? `处理中 ${handle}` : undefined;
}
