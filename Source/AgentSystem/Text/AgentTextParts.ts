/**
 * Structured text used by runtime-owned summaries.
 *
 * Identity is represented as data instead of an interpolated string. This
 * keeps summaries safe when they contain prompt syntax, JSON, or user text.
 */
export const AgentIdentityRoles = ["user", "resident"] as const;
export type AgentIdentityRole = (typeof AgentIdentityRoles)[number];

export interface AgentIdentityDisplayValues {
  readonly user: string;
  readonly resident: string;
}

export type AgentTextPart =
  { readonly kind: "text"; readonly text: string } | { readonly kind: "identity"; readonly role: AgentIdentityRole };

export type AgentTextParts = readonly AgentTextPart[];

const DefaultIdentityDisplayValues: AgentIdentityDisplayValues = Object.freeze({
  user: "user",
  resident: "resident",
});

/** Creates a compact immutable part list and joins adjacent prose parts. */
export function createAgentTextParts(parts: readonly AgentTextPart[]): AgentTextParts {
  const normalized: AgentTextPart[] = [];
  for (const part of parts) {
    if (part.kind === "identity") {
      normalized.push({ kind: "identity", role: part.role });
      continue;
    }
    const text = part.text;
    if (!text) continue;
    const previous = normalized.at(-1);
    if (previous?.kind === "text") {
      normalized[normalized.length - 1] = { kind: "text", text: previous.text + text };
    } else {
      normalized.push({ kind: "text", text });
    }
  }
  return normalized;
}

export function textPart(text: string): AgentTextPart {
  return { kind: "text", text };
}

export function identityPart(role: AgentIdentityRole): AgentTextPart {
  return { kind: "identity", role };
}

export function renderAgentTextParts(
  parts: AgentTextParts,
  values: AgentIdentityDisplayValues = DefaultIdentityDisplayValues,
): string {
  const displayValues = {
    user: requireDisplayValue(values.user, "user"),
    resident: requireDisplayValue(values.resident, "resident"),
  } satisfies AgentIdentityDisplayValues;
  return parts.map((part) => (part.kind === "text" ? part.text : displayValues[part.role])).join("");
}

/** Validates data loaded from a structured-parts column. */
export function parseAgentTextParts(value: unknown, label: string): AgentTextParts {
  if (!Array.isArray(value)) throw new Error(`${label} must contain a text-part array.`);
  return createAgentTextParts(
    value.map((part, index) => {
      if (!part || typeof part !== "object" || Array.isArray(part)) {
        throw new Error(`${label}[${index}] must be a text-part object.`);
      }
      const candidate = part as Record<string, unknown>;
      if (candidate.kind === "text" && typeof candidate.text === "string") {
        return textPart(candidate.text);
      }
      if (candidate.kind === "identity" && AgentIdentityRoles.includes(candidate.role as AgentIdentityRole)) {
        return identityPart(candidate.role as AgentIdentityRole);
      }
      throw new Error(`${label}[${index}] has an unsupported text-part shape.`);
    }),
  );
}

/**
 * Reads pre-protocol text without treating any syntax as executable. Only the
 * two historical identity references are projected; every other character is
 * preserved literally so old records cannot crash materialization.
 */
export function projectLegacyIdentityText(value: string): AgentTextParts {
  const parts: AgentTextPart[] = [];
  const referencePattern = /\{\{\s*(user|resident)\s*\}\}/gu;
  let cursor = 0;
  for (const match of value.matchAll(referencePattern)) {
    const index = match.index ?? cursor;
    if (index > cursor) parts.push(textPart(value.slice(cursor, index)));
    parts.push(identityPart(match[1] as AgentIdentityRole));
    cursor = index + match[0].length;
  }
  if (cursor < value.length) parts.push(textPart(value.slice(cursor)));
  return createAgentTextParts(parts);
}

export function normalizeAgentTextValue(value: unknown, label: string): AgentTextParts {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) throw new Error(`${label} must not be empty.`);
    return projectLegacyIdentityText(text);
  }
  const parts = parseAgentTextParts(value, label);
  if (parts.length === 0) throw new Error(`${label} must not be empty.`);
  return parts;
}

function requireDisplayValue(value: string, role: AgentIdentityRole): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Identity display value '${role}' must not be empty.`);
  return normalized;
}
