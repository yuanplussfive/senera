import type { AgentSelfCommandOutput } from "./AgentSelfServiceTypes.js";
import { readAgentUnknownRecord } from "../Core/AgentUnknownValue.js";

type AgentSelfValidationIssue = {
  readonly code: string;
  readonly path: readonly PropertyKey[];
  readonly message: string;
};

/** Projects schema failures into a repairable model-facing command result. */
export function projectAgentSelfInvocationValidationFailure(
  invocation: unknown,
  issues: readonly AgentSelfValidationIssue[],
): AgentSelfCommandOutput {
  return projectInvalidAgentSelfInvocation(issues, readAgentSelfCommandRoot(invocation));
}

export function readAgentSelfCommandRoot(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.command !== "string") return undefined;
  const command = value.command.trim();
  return command.length > 0 ? command : undefined;
}

export function projectInvalidAgentSelfInvocation(
  issues: readonly AgentSelfValidationIssue[],
  command?: string,
): AgentSelfCommandOutput {
  const projected = flattenAgentSelfValidationIssues(issues).slice(0, 8);
  const summary =
    projected.length > 0
      ? projected
          .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`)
          .join("; ")
      : "参数未通过当前命令契约校验。";
  return {
    ok: false,
    text: `Senera 命令参数无效${command ? `（${command}）` : ""}：${summary}。请先调用 capabilities 获取当前命令契约后重试。`,
    error: "invalid_command",
    data: {
      kind: "schema_validation",
      ...(command ? { command } : {}),
      issues: projected,
      repair: "使用 capabilities 返回的 command/action 和参数名；不要把 CLI 文本字段替换成未声明的字段。",
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function flattenAgentSelfValidationIssues(value: readonly unknown[]): {
  readonly code: string;
  readonly path: readonly string[];
  readonly message: string;
}[] {
  const flattened: { code: string; path: readonly string[]; message: string }[] = [];
  for (const entry of value) {
    const issue = readAgentUnknownRecord(entry);
    if (!issue) continue;
    const nested = Array.isArray(issue.errors)
      ? issue.errors.flatMap((branch) => (Array.isArray(branch) ? flattenAgentSelfValidationIssues(branch) : []))
      : [];
    if (nested.length > 0) {
      flattened.push(...nested);
      continue;
    }
    if (typeof issue.code !== "string" || typeof issue.message !== "string") continue;
    flattened.push({
      code: issue.code,
      path: Array.isArray(issue.path) ? issue.path.map(String) : [],
      message: issue.message,
    });
  }
  return flattened;
}
