import type { AgentIdentityDisplayValues } from "../Text/AgentTextParts.js";
import type { AgentMemOSSemanticDecision } from "./AgentMemOSSemanticTypes.js";

/** Stable labels used inside semantic memory instead of mutable profile display names. */
export const AgentMemOSSemanticIdentityLabels = {
  user: "用户",
  assistant: "我",
} as const;

interface IdentityReplacement {
  readonly source: string;
  readonly target: string;
}

/**
 * Keeps mutable profile display values out of learning inputs and semantic
 * memory. Replacements are derived from the active profile, never a name list.
 */
export function projectAgentMemOSSemanticIdentityText(
  value: string,
  identity: AgentIdentityDisplayValues | undefined,
): string {
  const replacements = identityReplacements(identity);
  if (replacements.length === 0 || !value) return value;
  const lookup = new Map(replacements.map((replacement) => [replacement.source.toLowerCase(), replacement.target]));
  const pattern = replacements.map((replacement) => escapeRegularExpression(replacement.source)).join("|");
  return value.replace(new RegExp(pattern, "giu"), (match) => lookup.get(match.toLowerCase()) ?? match);
}

/** Applies the same profile-derived projection to structured context values. */
export function projectAgentMemOSSemanticIdentityValue<T>(
  value: T,
  identity: AgentIdentityDisplayValues | undefined,
): T {
  if (!identity) return value;
  return projectValue(value, identity) as T;
}

export function projectAgentMemOSSemanticIdentityDecision(
  decision: AgentMemOSSemanticDecision,
  identity: AgentIdentityDisplayValues | undefined,
): AgentMemOSSemanticDecision {
  if (decision.action === "skip") return decision;
  return {
    ...decision,
    topic: projectAgentMemOSSemanticIdentityText(decision.topic, identity),
    summary: projectAgentMemOSSemanticIdentityText(decision.summary, identity),
  };
}

function projectValue(value: unknown, identity: AgentIdentityDisplayValues): unknown {
  if (typeof value === "string") return projectAgentMemOSSemanticIdentityText(value, identity);
  if (Array.isArray(value)) return value.map((entry) => projectValue(entry, identity));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, projectValue(entry, identity)]));
}

function identityReplacements(identity: AgentIdentityDisplayValues | undefined): IdentityReplacement[] {
  if (!identity) return [];
  const replacements = [
    { source: identity.user.trim(), target: AgentMemOSSemanticIdentityLabels.user },
    { source: identity.assistant.trim(), target: AgentMemOSSemanticIdentityLabels.assistant },
  ].filter((replacement) => replacement.source.length > 0);
  const unique = new Map<string, IdentityReplacement>();
  for (const replacement of replacements) unique.set(replacement.source.toLowerCase(), replacement);
  return [...unique.values()].sort((left, right) => right.source.length - left.source.length);
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
}
