export const AgentToolArgumentArrayItemKey = "item";

export function normalizeToolStringArgument(value: unknown): unknown {
  return typeof value === "number" || typeof value === "boolean" ? String(value) : value;
}

export function normalizeToolNumberArgument(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? Number(trimmed) : value;
}

export function normalizeToolArrayArgument(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const item = (value as Record<string, unknown>)[AgentToolArgumentArrayItemKey];
  return Array.isArray(item) ? item : value;
}
