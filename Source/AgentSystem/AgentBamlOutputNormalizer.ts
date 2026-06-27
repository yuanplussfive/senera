import type { z } from "zod";

export interface AgentBamlParseSuccess<T> {
  success: true;
  data: T;
  normalized: unknown;
}

export interface AgentBamlParseFailure {
  success: false;
  error: z.ZodError;
  issues: string[];
  normalized: unknown;
}

export type AgentBamlParseResult<T> = AgentBamlParseSuccess<T> | AgentBamlParseFailure;

export function normalizeBamlOptionalFields<T>(value: T): T {
  return normalizeValue(value) as T;
}

export function parseNormalizedBamlOutput<T>(
  schema: z.ZodType<T>,
  value: unknown,
): T {
  return schema.parse(normalizeBamlOptionalFields(value));
}

export function safeParseNormalizedBamlOutput<T>(
  schema: z.ZodType<T>,
  value: unknown,
): AgentBamlParseResult<T> {
  const normalized = normalizeBamlOptionalFields(value);
  const parsed = schema.safeParse(normalized);
  if (parsed.success) {
    return {
      success: true,
      data: parsed.data,
      normalized,
    };
  }

  return {
    success: false,
    error: parsed.error,
    issues: formatBamlValidationIssues(parsed.error.issues),
    normalized,
  };
}

export function formatBamlValidationIssues(issues: readonly z.ZodIssue[]): string[] {
  return issues.map((issue) => `${formatBamlIssuePath(issue.path)}: ${issue.message}`);
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== null)
      .map(([key, child]) => [key, normalizeValue(child)]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatBamlIssuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return "/";
  }

  return path.reduce<string>((output, part) => {
    if (typeof part === "number") {
      return `${output}[${part}]`;
    }
    const segment = typeof part === "symbol" ? String(part) : part;
    return output ? `${output}.${segment}` : segment;
  }, "");
}
