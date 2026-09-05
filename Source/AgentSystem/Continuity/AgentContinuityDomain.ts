import { z } from "zod";

export const AgentContinuityScopes = ["user", "session", "workspace", "world", "account", "runtime"] as const;
export type AgentContinuityScope = (typeof AgentContinuityScopes)[number];

export const AgentContinuityAuthorities = [
  "user_explicit",
  "tool_verified",
  "system_observed",
  "model_inferred",
] as const;
export type AgentContinuityAuthority = (typeof AgentContinuityAuthorities)[number];

export const AgentContinuityObservationKinds = [
  "conversation.user_message",
  "conversation.assistant_final",
  "tool.result",
  "learning.record",
  "runtime.clock",
  "runtime.signal",
] as const;
export type AgentContinuityObservationKind = (typeof AgentContinuityObservationKinds)[number];

export const AgentContinuityEventObservationKinds = [
  "conversation.user_message",
  "conversation.assistant_final",
  "tool.result",
  "runtime.signal",
] as const satisfies readonly AgentContinuityObservationKind[];

export const AgentContinuityRuleStatuses = [
  "armed",
  "partial",
  "triggered",
  "resolved",
  "cancelled",
  "expired",
] as const;
export type AgentContinuityRuleStatus = (typeof AgentContinuityRuleStatuses)[number];

export const AgentContinuityRuleMaturities = ["candidate", "active", "established"] as const;
export type AgentContinuityRuleMaturity = (typeof AgentContinuityRuleMaturities)[number];

export const AgentContinuityTemporalKinds = [
  "persistent",
  "instant",
  "interval",
  "until_condition",
  "recurring",
] as const;
export type AgentContinuityTemporalKind = (typeof AgentContinuityTemporalKinds)[number];

export interface AgentContinuityScopeRef {
  readonly kind: AgentContinuityScope;
  readonly id: string;
}

export interface AgentContinuityTemporalWindow {
  readonly kind: AgentContinuityTemporalKind;
  readonly startsAt?: string;
  readonly endsAt?: string;
  readonly timeZone: string;
}

export interface AgentContinuityObservation {
  readonly id: string;
  readonly uri: string;
  readonly kind: AgentContinuityObservationKind;
  /** Optional source text used only by the local index, never by prompt projection. */
  readonly searchText?: string;
  readonly summary: string;
  readonly payload: Record<string, unknown>;
  readonly sourceRefs: readonly string[];
  readonly watermark: string;
  readonly scope: AgentContinuityScopeRef;
  readonly authority: AgentContinuityAuthority;
  readonly confidence: number;
  readonly occurredAt: string;
  readonly observedAt: string;
  readonly createdAtMs: number;
}

export interface AgentContinuitySignal {
  readonly scope: AgentContinuityScopeRef;
  readonly namespace: string;
  readonly key: string;
  readonly value: unknown;
  readonly valueType: "boolean" | "number" | "string" | "json";
  readonly authority: AgentContinuityAuthority;
  readonly confidence: number;
  readonly observedAt: string;
  readonly expiresAt?: string;
  readonly sourceRefs: readonly string[];
}

export type AgentContinuityScalar = string | number | boolean;

export type AgentContinuityCondition =
  | { readonly kind: "always" }
  | { readonly kind: "all"; readonly children: readonly AgentContinuityCondition[] }
  | { readonly kind: "any"; readonly children: readonly AgentContinuityCondition[] }
  | {
      readonly kind: "at_least";
      readonly minimum: number;
      readonly children: readonly AgentContinuityCondition[];
    }
  | {
      readonly kind: "score";
      readonly threshold: number;
      readonly children: readonly AgentContinuityCondition[];
    }
  | { readonly kind: "not"; readonly child: AgentContinuityCondition }
  | { readonly kind: "time_at_or_after"; readonly at: string }
  | {
      readonly kind: "signal";
      readonly namespace: string;
      readonly key: string;
      readonly label?: string;
      readonly operator:
        | "exists"
        | "equals"
        | "not_equals"
        | "greater_than"
        | "greater_than_or_equal"
        | "less_than"
        | "less_than_or_equal";
      readonly value?: AgentContinuityScalar;
    };

export interface AgentContinuityRuleAction {
  readonly kind: "recall" | "notify";
  readonly summary: string;
  readonly activation: "while_true" | "once";
}

export interface AgentContinuityRule {
  readonly id: string;
  readonly uri: string;
  readonly title: string;
  readonly condition: AgentContinuityCondition;
  readonly action: AgentContinuityRuleAction;
  readonly scope: AgentContinuityScopeRef;
  readonly authority: AgentContinuityAuthority;
  readonly confidence: number;
  readonly temporal: AgentContinuityTemporalWindow;
  readonly sourceRefs: readonly string[];
  readonly semanticKey?: string;
  readonly conditionKey?: string;
  readonly effectKey?: string;
  readonly supportCount?: number;
  readonly supportMass?: number;
  readonly maturity?: AgentContinuityRuleMaturity;
  readonly supersededBy?: string;
  readonly status: AgentContinuityRuleStatus;
  readonly lastEvaluatedAt?: string;
  readonly lastTriggeredAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type AgentContinuityTruth = "true" | "false" | "unknown";

export interface AgentContinuityRuleEvaluation {
  readonly truth: AgentContinuityTruth;
  readonly status: AgentContinuityRuleStatus;
  readonly score: number;
  readonly threshold: number;
  readonly missingSignals: readonly string[];
  readonly conditions: readonly AgentContinuityConditionTrace[];
}

export interface AgentContinuityConditionTrace {
  readonly label: string;
  readonly truth: AgentContinuityTruth;
  readonly score: number;
  readonly actual?: AgentContinuityScalar;
}

export interface AgentContinuityPromptRule {
  readonly title: string;
  readonly action: string;
  readonly status: "partial" | "triggered";
  readonly missingSignals: readonly string[];
}

const ScalarSchema = z.union([z.string(), z.number().finite(), z.boolean()]);

const ConditionSchema: z.ZodType<AgentContinuityCondition> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("always") }).strict(),
    z.object({ kind: z.literal("all"), children: z.array(ConditionSchema).min(1) }).strict(),
    z.object({ kind: z.literal("any"), children: z.array(ConditionSchema).min(1) }).strict(),
    z
      .object({
        kind: z.literal("at_least"),
        minimum: z.number().int().min(1),
        children: z.array(ConditionSchema).min(1),
      })
      .strict(),
    z
      .object({
        kind: z.literal("score"),
        threshold: z.number().min(0).max(1),
        children: z.array(ConditionSchema).min(1),
      })
      .strict(),
    z.object({ kind: z.literal("not"), child: ConditionSchema }).strict(),
    z.object({ kind: z.literal("time_at_or_after"), at: z.string().datetime({ offset: true }) }).strict(),
    z
      .object({
        kind: z.literal("signal"),
        namespace: z.string().trim().min(1),
        key: z.string().trim().min(1),
        label: z.string().trim().min(1).optional(),
        operator: z.enum([
          "exists",
          "equals",
          "not_equals",
          "greater_than",
          "greater_than_or_equal",
          "less_than",
          "less_than_or_equal",
        ]),
        value: ScalarSchema.optional(),
      })
      .strict(),
  ]),
);

export function parseAgentContinuityCondition(value: string): AgentContinuityCondition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Continuity condition must be valid JSON.");
  }
  return ConditionSchema.parse(parsed);
}

export function serializeAgentContinuityCondition(condition: AgentContinuityCondition): string {
  return JSON.stringify(ConditionSchema.parse(condition));
}

export function serializeAgentContinuityAction(action: AgentContinuityRuleAction): string {
  return JSON.stringify(action);
}

export function parseAgentContinuityAction(value: string): AgentContinuityRuleAction {
  const parsed = z
    .object({
      kind: z.enum(["recall", "notify"]),
      summary: z.string().trim().min(1),
      activation: z.enum(["while_true", "once"]).optional(),
    })
    .strict()
    .parse(JSON.parse(value));
  return {
    ...parsed,
    activation: parsed.activation ?? (parsed.kind === "notify" ? "once" : "while_true"),
  };
}

export function isAgentContinuityTemporalActive(temporal: AgentContinuityTemporalWindow, now: Date): boolean {
  const nowMs = now.getTime();
  const startsAtMs = temporal.startsAt ? Date.parse(temporal.startsAt) : Number.NEGATIVE_INFINITY;
  const endsAtMs = temporal.endsAt ? Date.parse(temporal.endsAt) : Number.POSITIVE_INFINITY;
  if (Number.isNaN(startsAtMs) || Number.isNaN(endsAtMs)) return false;
  return nowMs >= startsAtMs && nowMs <= endsAtMs;
}

export function continuitySignalId(namespace: string, key: string): string {
  return `${namespace.trim()}.${key.trim()}`;
}

export function isAgentContinuityRuleUri(value: string): boolean {
  return /^senera:\/\/continuity-rule\/rule_[a-f0-9]+$/u.test(value.trim());
}

export function normalizeAgentContinuityScope(scope: AgentContinuityScopeRef): AgentContinuityScopeRef {
  const kind = z.enum(AgentContinuityScopes).parse(scope.kind);
  const id = scope.id.trim();
  if (!id) throw new Error("Continuity scope id cannot be empty.");
  return { kind, id };
}
