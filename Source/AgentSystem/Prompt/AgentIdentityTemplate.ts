/**
 * Controlled identity placeholders used by derived text such as temporal digests.
 * These are deliberately a small subset of Liquid: stored text may reference
 * the participants, but it cannot execute tags or filters when rendered.
 */
export const AgentIdentityTemplateKeys = ["user", "resident"] as const;
export type AgentIdentityTemplateKey = (typeof AgentIdentityTemplateKeys)[number];

export interface AgentIdentityTemplateValues {
  readonly user: string;
  readonly resident: string;
}

const SupportedPlaceholderPattern = /\{\{\s*(user|resident)\s*\}\}/gu;
const SupportedPlaceholderPresencePattern = /\{\{\s*(?:user|resident)\s*\}\}/u;
const AnyPlaceholderPattern = /\{\{[\s\S]*?\}\}/u;

/** Validates and canonicalizes the restricted placeholder syntax without changing prose. */
export function normalizeAgentIdentityTemplate(value: string): string {
  const normalized = value.replace(SupportedPlaceholderPattern, (_, key: AgentIdentityTemplateKey) => `{{${key}}}`);
  if (/\{%|\{#/u.test(normalized)) {
    throw new Error("Identity templates may contain only {{user}} and {{resident}} placeholders.");
  }
  const unsupportedText = normalized.replace(SupportedPlaceholderPattern, "");
  if (AnyPlaceholderPattern.test(unsupportedText) || /\{\{|\}\}/u.test(unsupportedText)) {
    throw new Error("Identity templates may contain only {{user}} and {{resident}} placeholders.");
  }
  return normalized;
}

/** Renders a previously validated identity template with the current display names. */
export function renderAgentIdentityTemplate(value: string, values: AgentIdentityTemplateValues): string {
  const template = normalizeAgentIdentityTemplate(value);
  const user = requireIdentityValue(values.user, "user");
  const resident = requireIdentityValue(values.resident, "resident");
  return template.replace(SupportedPlaceholderPattern, (_, key: AgentIdentityTemplateKey) =>
    key === "user" ? user : resident,
  );
}

/** Renders only text that declares one of the supported identity placeholders. */
export function renderAgentIdentityTemplateIfPresent(value: string, values: AgentIdentityTemplateValues): string {
  return SupportedPlaceholderPresencePattern.test(value) ? renderAgentIdentityTemplate(value, values) : value;
}

function requireIdentityValue(value: string, key: AgentIdentityTemplateKey): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Identity template value '${key}' must not be empty.`);
  return normalized;
}
