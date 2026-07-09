import type { z } from "zod";
import {
  formatAgentStructuredIssues,
  zodIssuesToAgentStructuredIssues,
  type AgentStructuredIssue,
} from "../Diagnostics/AgentStructuredIssue.js";

export interface AgentBamlParseSuccess<T> {
  success: true;
  data: T;
  normalized: unknown;
}

export interface AgentBamlParseFailure {
  success: false;
  error: z.ZodError;
  issues: string[];
  structuredIssues: AgentStructuredIssue[];
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

  const structuredIssues = zodIssuesToAgentStructuredIssues(parsed.error.issues);
  return {
    success: false,
    error: parsed.error,
    issues: formatAgentStructuredIssues(structuredIssues),
    structuredIssues,
    normalized,
  };
}

export function formatBamlValidationIssues(issues: readonly z.ZodIssue[]): string[] {
  return formatAgentStructuredIssues(zodIssuesToAgentStructuredIssues(issues));
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
