import {
  AgentBamlModelCallError,
  AgentBamlStructuredOutputError,
} from "../BamlClient/AgentBamlStructuredOutputRunner.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";
import { ModelProviderHttpError, ModelRequestTimeoutError } from "./ModelHttpErrors.js";
import { z } from "zod";

export type AgentModelFailureCode =
  | "http_error"
  | "timeout"
  | "transport_error"
  | "tool_call_missing"
  | "invalid_tool_arguments"
  | "structured_output_error"
  | "provider_error";

export interface AgentModelFailureDiagnostic {
  readonly code: AgentModelFailureCode;
  readonly status?: number;
}

export class AgentRequiredModelToolCallError extends AgentBaseError {
  constructor(
    readonly requiredToolName: string,
    readonly returnedToolNames: readonly string[],
  ) {
    super(
      `Model response did not return required tool ${requiredToolName}: ${returnedToolNames.join(", ") || "none"}.`,
    );
  }
}

export class AgentInvalidModelToolArgumentsError extends AgentBaseError {
  constructor(
    readonly toolName: string,
    readonly issues: readonly string[] = [],
  ) {
    super(
      [
        `Model response returned invalid arguments for tool ${toolName}.`,
        ...(issues.length > 0 ? [`${issues.join("; ")}`] : []),
      ].join(" "),
    );
  }
}

export function mapAgentModelFailure(error: unknown): AgentModelFailureDiagnostic {
  const status = findStatus(error);
  if (status !== undefined) return { code: "http_error", status };
  if (hasErrorType(error, ModelRequestTimeoutError) || messageContains(error, "timeout")) {
    return { code: "timeout" };
  }
  if (hasErrorType(error, ModelProviderHttpError)) return { code: "http_error" };
  if (error instanceof AgentBamlStructuredOutputError || hasErrorType(error, AgentBamlStructuredOutputError)) {
    return { code: "structured_output_error" };
  }
  if (error instanceof z.ZodError) return { code: "structured_output_error" };
  if (error instanceof AgentBamlModelCallError || hasErrorType(error, AgentBamlModelCallError)) {
    return mapAgentModelFailure(readNestedError(error));
  }
  if (hasErrorType(error, AgentRequiredModelToolCallError)) return { code: "tool_call_missing" };
  if (hasErrorType(error, AgentInvalidModelToolArgumentsError)) return { code: "invalid_tool_arguments" };

  const message = errorMessage(error);
  if (/connection error|network|socket|econn|fetch failed/i.test(message)) {
    return { code: "transport_error" };
  }
  return { code: "provider_error" };
}

export function formatAgentModelFailure(diagnostic: AgentModelFailureDiagnostic): string {
  return diagnostic.status === undefined ? diagnostic.code : `${diagnostic.code}:${diagnostic.status}`;
}

function findStatus(error: unknown, seen = new Set<object>()): number | undefined {
  if (!error || typeof error !== "object" || seen.has(error)) return undefined;
  seen.add(error);
  for (const key of ["status", "status_code", "statusCode"]) {
    const value = Reflect.get(error, key);
    if (typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599) return value;
  }
  for (const key of ["cause", "originalError"]) {
    const nested = findStatus(Reflect.get(error, key), seen);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function hasErrorType(error: unknown, type: abstract new (...args: never[]) => Error): boolean {
  if (!error || typeof error !== "object") return false;
  const seen = new Set<object>();
  const pending: unknown[] = [error];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    if (current instanceof type) return true;
    seen.add(current);
    pending.push(Reflect.get(current, "cause"), Reflect.get(current, "originalError"));
  }
  return false;
}

function readNestedError(error: unknown): unknown {
  if (!error || typeof error !== "object") return error;
  return Reflect.get(error, "originalError") ?? Reflect.get(error, "cause") ?? error;
}

function messageContains(error: unknown, pattern: string): boolean {
  return errorMessage(error).toLowerCase().includes(pattern.toLowerCase());
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
