import crypto from "node:crypto";
import { isAgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import { projectAgentTextPreview, type AgentTextPreview } from "./AgentTextProjection.js";

/**
 * One source-independent policy for data that may cross into a model-visible
 * surface. Callers choose the surface budget; the projector does not know
 * whether a value came from a tool, document, browser, or user input.
 */
export interface AgentModelPayloadProjectionPolicy {
  readonly maxStringCharacters: number;
  readonly maxDepth?: number;
  readonly maxNodes?: number;
}

export interface AgentModelPayloadSignal {
  readonly kind: "inline_media" | "encoded_run" | "string_limit" | "depth_limit" | "node_limit";
  readonly path: string;
  readonly originalCharacters?: number;
  readonly mediaType?: string;
}

export interface AgentModelPayloadProjection {
  readonly value: unknown;
  readonly changed: boolean;
  readonly signals: readonly AgentModelPayloadSignal[];
}

export const AgentModelPayloadProjectionDefaults = {
  maxStringCharacters: 12_000,
  maxDepth: 8,
  maxNodes: 2_048,
} as const satisfies AgentModelPayloadProjectionPolicy;

const InlineDataUriPattern = /data:([^;,\s]+)(?:;[^,\s]*)*;base64,([A-Za-z0-9+/=\r\n]+)/gu;
const EncodedRunPattern = /(^|[^A-Za-z0-9+/=])([A-Za-z0-9+/=]{1024,})(?![A-Za-z0-9+/=])/gu;

export function projectAgentModelPayload(
  value: unknown,
  policy: AgentModelPayloadProjectionPolicy = AgentModelPayloadProjectionDefaults,
): AgentModelPayloadProjection {
  const state: ProjectionState = {
    maxStringCharacters: normalizePositiveInteger(policy.maxStringCharacters),
    maxDepth: normalizePositiveInteger(policy.maxDepth ?? AgentModelPayloadProjectionDefaults.maxDepth),
    maxNodes: normalizePositiveInteger(policy.maxNodes ?? AgentModelPayloadProjectionDefaults.maxNodes),
    signals: [],
    nodes: 0,
    ancestors: new WeakSet<object>(),
  };
  return { value: visit(value, "$", 0, state), changed: state.signals.length > 0, signals: state.signals };
}

export function projectAgentModelText(
  value: string,
  policy: AgentModelPayloadProjectionPolicy = AgentModelPayloadProjectionDefaults,
  path = "$",
): AgentTextPreview & { signals: readonly AgentModelPayloadSignal[] } {
  const signals: AgentModelPayloadSignal[] = [];
  const sanitized = value.replace(InlineDataUriPattern, (_match, mediaType: string, encoded: string) => {
    const encodedCharacters = encoded.replace(/\s+/gu, "").length;
    signals.push({
      kind: "inline_media",
      path,
      originalCharacters: encodedCharacters,
      mediaType,
    });
    const digest = crypto.createHash("sha256").update(encoded).digest("hex").slice(0, 16);
    return `[inline media omitted mediaType=${mediaType} encodedCharacters=${encodedCharacters} sha256=${digest}]`;
  });
  const encoded = sanitized.replace(EncodedRunPattern, (match, prefix: string, run: string) => {
    if (!looksLikeEncodedRun(run)) return match;
    signals.push({ kind: "encoded_run", path, originalCharacters: run.length });
    const digest = crypto.createHash("sha256").update(run).digest("hex").slice(0, 16);
    return `${prefix}[encoded payload omitted characters=${run.length} sha256=${digest}]`;
  });
  const preview = projectAgentTextPreview(encoded, policy.maxStringCharacters);
  if (preview.truncated) {
    signals.push({ kind: "string_limit", path, originalCharacters: preview.originalChars });
  }
  return { ...preview, signals };
}

function looksLikeEncodedRun(value: string): boolean {
  if (value.length < 1_024 || value.length % 4 !== 0) return false;
  const alphabetCharacters = value.replace(/[A-Za-z0-9+/=]/gu, "").length;
  return alphabetCharacters === 0 && /[+/=]/u.test(value);
}

interface ProjectionState {
  readonly maxStringCharacters: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly signals: AgentModelPayloadSignal[];
  readonly ancestors: WeakSet<object>;
  nodes: number;
}

function visit(value: unknown, path: string, depth: number, state: ProjectionState): unknown {
  if (typeof value === "string") {
    const projected = projectAgentModelText(value, { maxStringCharacters: state.maxStringCharacters }, path);
    state.signals.push(...projected.signals);
    return projected.text;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return typeof value === "bigint" ? String(value) : value;
  }
  if (!value || typeof value !== "object") return undefined;
  if (state.nodes >= state.maxNodes) {
    state.signals.push({ kind: "node_limit", path });
    return Array.isArray(value) ? [] : {};
  }
  if (depth >= state.maxDepth) {
    state.signals.push({ kind: "depth_limit", path });
    return Array.isArray(value) ? [] : {};
  }
  if (state.ancestors.has(value)) return Array.isArray(value) ? [] : {};

  state.nodes += 1;
  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((entry, index) => visit(entry, `${path}[${index}]`, depth + 1, state));
    if (!isAgentUnknownRecord(value)) return undefined;
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, visit(entry, `${path}.${key}`, depth + 1, state)]),
    );
  } finally {
    state.ancestors.delete(value);
  }
}

function normalizePositiveInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}
