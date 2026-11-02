import type { TimelineStep } from "../../store/sessionStore";
import { readTypedAtPointer } from "./toolActivityPresentation";

const ResultPreviewLength = 140;

/** Reads the raw execution result without exposing lifecycle or presentation metadata. */
export function readToolResultValue(step: TimelineStep): unknown {
  if (step.toolResult !== undefined) {
    return unwrapLegacyPiObservationDetail(step, unwrapExecutionResult(step, step.toolResult));
  }
  return undefined;
}

/**
 * Resolves the concise failure message carried by a tool lifecycle event.
 * Older Pi traces persisted an attributed Observation document verbatim. The
 * decoder accepts only that protocol's complete structural identity before
 * reading its canonical error, so ordinary tool output is never interpreted
 * as transport metadata.
 */
export function readToolFailureMessage(step: TimelineStep): string | undefined {
  return (
    readPiObservationFailure(step.toolErrorMessage) ??
    normalizeFailureMessage(step.toolErrorMessage) ??
    normalizeFailureMessage(step.errorMessage)
  );
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
 * Pi v5 traces written before result projection stored `observation.detail`,
 * while every presentation pointer is defined against `detail.result`. This
 * is a closed historical wire shape, not a generic "result" unwrapping rule.
 */
function unwrapLegacyPiObservationDetail(step: TimelineStep, value: unknown): unknown {
  if (!isLegacyPiObservationDetail(step, value)) return value;
  return value.result;
}

const LegacyPiObservationDetailKeys = new Set([
  "headline",
  "summary",
  "error_detail",
  "process",
  "retrieval",
  "continuation",
  "evidence",
  "delta",
  "workspace",
  "result",
  "arguments",
  "projection",
  "summary_facts",
  "limitations",
  "outcome",
  "semantic_digest",
  "perception",
  "notice",
]);

function isLegacyPiObservationDetail(
  step: TimelineStep,
  value: unknown,
): value is Record<string, unknown> & { readonly result: unknown } {
  if (step.toolOrigin?.kind !== "system" || !isRecord(value)) return false;
  if (!Array.isArray(value.evidence) || !("result" in value)) return false;
  if (!Object.keys(value).every((key) => LegacyPiObservationDetailKeys.has(key))) return false;

  // The historical wrapper is only removed when the actual presentation
  // contract resolves beneath `result`, not at the wrapper itself. This keeps
  // an independently authored system Tool that intentionally returns an
  // `{ evidence, result }` business value intact.
  const pointers = resultPointersFor(step);
  return (
    pointers.length > 0 &&
    pointers.every((pointer) => readTypedAtPointer(value, pointer).length === 0) &&
    pointers.some((pointer) => readTypedAtPointer(value.result, pointer).length > 0)
  );
}

function resultPointersFor(step: TimelineStep): readonly string[] {
  const preview = step.toolOrigin?.presentation?.preview;
  return [
    ...(preview?.result?.rows.map((row) => row.pointer) ?? []),
    preview?.result?.more?.pointer,
    preview?.body?.from === "result" ? preview.body.pointer : undefined,
  ].filter((pointer): pointer is string => typeof pointer === "string" && pointer.length > 0);
}

function readPiObservationFailure(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = parseAttributedPiObservation(value);
  const error = parsed?.error;
  return isRecord(error) && typeof error.message === "string" ? normalizeFailureMessage(error.message) : undefined;
}

function parseAttributedPiObservation(value: string): Record<string, unknown> | undefined {
  const source = unwrapAttributedPiObservation(value);
  try {
    const parsed: unknown = JSON.parse(source);
    return isPiObservation(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function unwrapAttributedPiObservation(value: string): string {
  const prefix = '<observation attribution="tool">';
  const suffix = "</observation>";
  if (!value.startsWith(prefix) || !value.endsWith(suffix)) return value;
  return value.slice(prefix.length, -suffix.length).replace(/&quot;|&apos;|&gt;|&lt;|&amp;/gu, (entity) => {
    switch (entity) {
      case "&quot;":
        return '"';
      case "&apos;":
        return "'";
      case "&gt;":
        return ">";
      case "&lt;":
        return "<";
      case "&amp;":
        return "&";
      default:
        return entity;
    }
  });
}

function isPiObservation(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (!/^senera\.tool_observation\.v\d+$/u.test(value.type)) return false;
  return (
    typeof value.status === "string" &&
    typeof value.execution_status === "string" &&
    typeof value.output_availability === "string" &&
    isRecord(value.detail)
  );
}

function normalizeFailureMessage(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
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
