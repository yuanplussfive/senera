import { z, type ZodType } from "zod";

/**
 * Declarative sensitivity rules for `senera config update` paths.
 *
 * - `guard`  paths are machine-adjudicable: the value must pass the declared
 *   constraint schema, then the update proceeds. No human needed.
 * - `human`  paths carry security semantics (exposure surface, credential,
 *   traffic redirection). They require an approval channel decision.
 *
 * Matching picks the most specific rule (longest dot-pattern), so a narrow
 * guard rule can refine a broader human rule for the same tree.
 */
export const AgentSelfConfigPathLevels = {
  Guard: "guard",
  Human: "human",
} as const;

export type AgentSelfConfigPathLevel = (typeof AgentSelfConfigPathLevels)[keyof typeof AgentSelfConfigPathLevels];

export interface AgentSelfConfigPathRule {
  readonly pattern: string;
  readonly level: AgentSelfConfigPathLevel;
  readonly reason: string;
  readonly validate?: ZodType;
}

export const AgentSelfConfigPathRules: readonly AgentSelfConfigPathRule[] = [
  {
    pattern: "Server.AccessControl.*",
    level: "human",
    reason: "修改访问控制策略会改变系统暴露面，需要人工确认。",
  },
  { pattern: "Server.Host", level: "human", reason: "修改监听地址会影响所有客户端连接。" },
  { pattern: "Server.Port", level: "human", reason: "修改监听端口会影响所有客户端连接。" },
  {
    pattern: "ModelProviderEndpoints.*",
    level: "human",
    reason: "修改模型端点可能把请求重定向到其他服务器。",
  },
  {
    pattern: "ModelProviders.*",
    level: "human",
    reason: "模型提供方配置含凭证，修改需要人工确认。",
  },
  {
    pattern: "DefaultModelProviderId",
    level: "human",
    reason: "修改默认模型会影响所有新会话。",
  },
  {
    pattern: "ModelProviders.*.Temperature",
    level: "guard",
    validate: z.number().min(0).max(2),
    reason: "采样温度超出安全范围。",
  },
  {
    pattern: "ModelProviders.*.TopP",
    level: "guard",
    validate: z.number().min(0).max(1),
    reason: "核采样参数超出安全范围。",
  },
  {
    pattern: "ModelProviders.*.PresencePenalty",
    level: "guard",
    validate: z.number().min(-2).max(2),
    reason: "存在惩罚参数超出安全范围。",
  },
  {
    pattern: "ModelProviders.*.FrequencyPenalty",
    level: "guard",
    validate: z.number().min(-2).max(2),
    reason: "频率惩罚参数超出安全范围。",
  },
];

const rulePatternCache = new Map<string, RegExp>();

function compileRulePattern(pattern: string): RegExp {
  const cached = rulePatternCache.get(pattern);
  if (cached) return cached;
  const source = pattern
    .split(".")
    .map((segment) => (segment === "*" ? "[^.]+(?:\\.[^.]+)*" : escapeRegExpSegment(segment)))
    .join("\\.");
  const regex = new RegExp(`^${source}$`);
  rulePatternCache.set(pattern, regex);
  return regex;
}

function escapeRegExpSegment(segment: string): string {
  return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Resolves the most specific rule matching a dot-separated config path. */
export function resolveAgentSelfConfigPathRule(path: string): AgentSelfConfigPathRule | undefined {
  const normalized = path.trim();
  if (normalized === "") return undefined;
  let best: { readonly rule: AgentSelfConfigPathRule; readonly segments: number } | undefined;
  for (const rule of AgentSelfConfigPathRules) {
    if (!compileRulePattern(rule.pattern).test(normalized)) continue;
    const segments = rule.pattern.split(".").length;
    if (!best || segments > best.segments) best = { rule, segments };
  }
  return best?.rule;
}

export function validateAgentSelfConfigPathValue(
  rule: AgentSelfConfigPathRule,
  value: unknown,
): { readonly valid: boolean; readonly message?: string } {
  if (!rule.validate) return { valid: true };
  const result = rule.validate.safeParse(value);
  if (result.success) return { valid: true };
  return { valid: false, message: `${rule.reason} (${describeValidationIssues(result.error)})` };
}

function describeValidationIssues(error: {
  readonly issues: readonly { readonly path: readonly (string | number | symbol)[]; readonly message: string }[];
}): string {
  const issue = error.issues[0];
  if (!issue) return "值不符合安全约束。";
  return `${issue.path.length > 0 ? issue.path.join(".") : "value"}: ${issue.message}`;
}
