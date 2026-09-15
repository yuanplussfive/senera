import type { TimelineStep } from "../../store/sessionStore";

const ResultPreviewLength = 140;

/** Reads the raw execution result without exposing lifecycle or presentation metadata. */
export function readToolResultValue(step: TimelineStep): unknown {
  if (step.toolResult !== undefined) return unwrapExecutionResult(step, step.toolResult);
  if (step.toolOutput?.stdout || step.toolOutput?.stderr) {
    return {
      ...(step.toolOutput.stdout ? { stdout: step.toolOutput.stdout } : {}),
      ...(step.toolOutput.stderr ? { stderr: step.toolOutput.stderr } : {}),
    };
  }
  if (step.toolErrorMessage) return { error: step.toolErrorMessage };
  return undefined;
}

/** Produces a bounded, tool-agnostic inline result for compact activity rows. */
export function projectToolResultPreview(step: TimelineStep): string | undefined {
  const value = readToolResultValue(step);
  if (value === undefined) return undefined;

  const serialized = typeof value === "string" ? value : serializeResult(value);
  const normalized = serialized.replace(/\s+/gu, " ").trim();
  if (!normalized) return undefined;
  return normalized.length > ResultPreviewLength ? `${normalized.slice(0, ResultPreviewLength - 1)}…` : normalized;
}

function serializeResult(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}

function unwrapExecutionResult(step: TimelineStep, value: unknown): unknown {
  if (!isRecord(value) || !("result" in value)) return value;
  if (!isExecutionEnvelope(step, value)) return value;
  return value.result;
}

/**
 * Handles an in-flight envelope from an older server without treating an
 * arbitrary business object with a `result` field as lifecycle metadata.
 */
function isExecutionEnvelope(step: TimelineStep, value: Record<string, unknown>): boolean {
  const callMatches = typeof value.callId === "string" && (!step.callId || value.callId === step.callId);
  const nameMatches = typeof value.name === "string" && (!step.toolName || value.name === step.toolName);
  if (!callMatches && !nameMatches) return false;
  return "arguments" in value || "process" in value || "outcome" in value || "presentation" in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
