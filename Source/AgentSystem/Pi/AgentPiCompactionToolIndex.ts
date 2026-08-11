import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { defineSeneraProtocol } from "../Core/AgentProtocolIdentity.js";
import { uniqueStrings } from "../Core/AgentCollections.js";
import { readAgentNonBlankString } from "../Core/AgentUnknownValue.js";
import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";
import {
  readAgentPiMessageTextContent,
  readAgentPiToolObservationArtifactUri,
  readAgentPiToolObservation,
  type AgentPiToolObservation,
} from "./AgentPiToolObservation.js";
import {
  DefaultAgentPiCompactionProjectionPolicy,
  normalizeAgentPiCompactionLimit,
} from "./AgentPiCompactionProjectionPolicy.js";

export const AgentPiCompactionToolIndexProtocol = defineSeneraProtocol("compaction_tool_index", 1);
export const AgentPiCompactionToolIndexCustomType = "senera.compaction_tool_index";

const NonBlankStringSchema = z.string().trim().min(1);

const ToolCallErrorSchema = z
  .object({
    code: NonBlankStringSchema.optional(),
    kind: NonBlankStringSchema.optional(),
    source: NonBlankStringSchema.optional(),
    message: NonBlankStringSchema.optional(),
  })
  .strict();

export const AgentPiCompactionToolCallEntrySchema = z
  .object({
    callId: NonBlankStringSchema,
    toolName: NonBlankStringSchema,
    status: z.enum(["success", "failure", "empty"]),
    argumentsPreview: z.string(),
    summary: NonBlankStringSchema.optional(),
    artifactUri: NonBlankStringSchema.optional(),
    evidenceUris: z.array(NonBlankStringSchema),
    error: ToolCallErrorSchema.optional(),
  })
  .strict();

export const AgentPiCompactionToolCallIndexSchema = z
  .object({
    type: z.literal(AgentPiCompactionToolIndexProtocol.type),
    calls: z.array(AgentPiCompactionToolCallEntrySchema),
    totalCalls: z.number().int().min(0),
    successCount: z.number().int().min(0),
    failureCount: z.number().int().min(0),
    emptyCount: z.number().int().min(0),
    evidenceUris: z.array(NonBlankStringSchema),
    artifactUris: z.array(NonBlankStringSchema),
  })
  .strict();

export type AgentPiCompactionToolCallEntry = z.infer<typeof AgentPiCompactionToolCallEntrySchema>;
export type AgentPiCompactionToolCallIndex = z.infer<typeof AgentPiCompactionToolCallIndexSchema>;

export interface AgentPiCompactionToolIndexReadResult {
  index: AgentPiCompactionToolCallIndex | undefined;
  invalidEntryId?: string;
}

export interface AgentPiCompactionToolIndexLimits {
  readonly maxIndexedCalls: number;
  readonly argumentsPreviewTokenBudget: number;
}

export const DefaultAgentPiCompactionToolIndexLimits: Readonly<AgentPiCompactionToolIndexLimits> = Object.freeze({
  maxIndexedCalls: DefaultAgentPiCompactionProjectionPolicy.maxIndexedCalls,
  argumentsPreviewTokenBudget: DefaultAgentPiCompactionProjectionPolicy.argumentsPreviewTokenBudget,
});

export function createAgentPiCompactionToolCallIndex(
  messages: readonly AgentMessage[],
  limits: AgentPiCompactionToolIndexLimits = DefaultAgentPiCompactionToolIndexLimits,
): AgentPiCompactionToolCallIndex {
  const normalizedLimits = normalizeToolIndexLimits(limits);
  const entries = extractToolCallEntries(messages, normalizedLimits);
  const trimmed = entries.slice(-normalizedLimits.maxIndexedCalls);
  return aggregateToolCallIndex(trimmed, entries.length);
}

export function readAgentPiCompactionToolCallIndex(
  entries: readonly SessionEntry[],
): AgentPiCompactionToolIndexReadResult {
  let entry: SessionEntry | undefined;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const candidate = entries[i];
    if (candidate?.type === "custom" && candidate.customType === AgentPiCompactionToolIndexCustomType) {
      entry = candidate;
      break;
    }
  }
  if (!entry || entry.type !== "custom") return { index: undefined };

  const parsed = AgentPiCompactionToolCallIndexSchema.safeParse(entry.data);
  if (parsed.success) return { index: parsed.data };
  return { index: undefined, invalidEntryId: entry.id };
}

export function mergeAgentPiCompactionToolCallIndexes(
  indexes: readonly (AgentPiCompactionToolCallIndex | undefined)[],
  maxIndexedCalls = DefaultAgentPiCompactionToolIndexLimits.maxIndexedCalls,
): AgentPiCompactionToolCallIndex {
  const limit = normalizeAgentPiCompactionLimit(maxIndexedCalls, "maxIndexedCalls");
  const present = indexes.filter((index): index is AgentPiCompactionToolCallIndex => index !== undefined);
  const byCallId = new Map<string, AgentPiCompactionToolCallEntry>();
  for (const index of present) {
    for (const call of index.calls) byCallId.set(call.callId, call);
  }
  const calls = [...byCallId.values()].slice(-limit);
  const aggregate = aggregateToolCallIndex(
    calls,
    present.reduce((total, index) => total + index.totalCalls, 0),
  );
  return {
    ...aggregate,
    evidenceUris: uniqueStrings(present.flatMap((index) => index.evidenceUris)),
    artifactUris: uniqueStrings(present.flatMap((index) => index.artifactUris)),
  };
}

interface PendingToolCall {
  callId: string;
  toolName: string;
  argumentsPreview: string;
  observation?: AgentPiToolObservation;
}

interface ResolvedToolCall extends PendingToolCall {
  observation: AgentPiToolObservation;
}

function extractToolCallEntries(
  messages: readonly AgentMessage[],
  limits: AgentPiCompactionToolIndexLimits,
): AgentPiCompactionToolCallEntry[] {
  const callsById = new Map<string, PendingToolCall>();

  for (const message of messages) {
    if (message.role === "assistant") collectAssistantToolCalls(message, callsById, limits);
    if (message.role === "toolResult") enrichWithToolResult(message, callsById);
  }

  return [...callsById.values()]
    .filter((pending): pending is ResolvedToolCall => pending.toolName.length > 0 && pending.observation !== undefined)
    .map((call) => projectToolCallEntry(call));
}

function collectAssistantToolCalls(
  message: Extract<AgentMessage, { role: "assistant" }>,
  callsById: Map<string, PendingToolCall>,
  limits: AgentPiCompactionToolIndexLimits,
): void {
  for (const block of message.content) {
    if (block.type !== "toolCall") continue;
    callsById.set(block.id, {
      callId: block.id,
      toolName: block.name,
      argumentsPreview: projectArgumentsPreview(block.arguments, limits.argumentsPreviewTokenBudget),
    });
  }
}

function enrichWithToolResult(
  message: Extract<AgentMessage, { role: "toolResult" }>,
  callsById: Map<string, PendingToolCall>,
): void {
  const callId = message.toolCallId;
  const observation = readAgentPiToolObservation(readAgentPiMessageTextContent(message));
  const pending = callsById.get(callId);
  if (pending) {
    if (pending.toolName !== message.toolName) {
      throw new Error(`Pi tool call ${callId} changed tool identity before compaction.`);
    }
    if (observation) pending.observation = observation;
  } else {
    callsById.set(callId, {
      callId,
      toolName: message.toolName,
      argumentsPreview: "",
      observation,
    });
  }
}

function projectToolCallEntry(call: ResolvedToolCall): AgentPiCompactionToolCallEntry {
  const obs = call.observation;
  const detail = obs.detail;
  const status = resolveEntryStatus(obs);
  const summaryText = readObservationSummary(detail);
  const artifactUriValue = readAgentPiToolObservationArtifactUri(obs);
  const evidenceUriList = uniqueStrings(
    detail.evidence.flatMap((entry) => (entry.evidence_uri ? [entry.evidence_uri] : [])),
  );
  const error = projectToolCallError(obs.error);

  return {
    callId: call.callId,
    toolName: call.toolName,
    status,
    argumentsPreview: call.argumentsPreview,
    ...(summaryText ? { summary: summaryText } : {}),
    ...(artifactUriValue ? { artifactUri: artifactUriValue } : {}),
    evidenceUris: evidenceUriList,
    ...(error ? { error } : {}),
  };
}

function normalizeToolIndexLimits(limits: AgentPiCompactionToolIndexLimits): AgentPiCompactionToolIndexLimits {
  return {
    maxIndexedCalls: normalizeAgentPiCompactionLimit(limits.maxIndexedCalls, "maxIndexedCalls"),
    argumentsPreviewTokenBudget: normalizeAgentPiCompactionLimit(
      limits.argumentsPreviewTokenBudget,
      "argumentsPreviewTokenBudget",
    ),
  };
}

function resolveEntryStatus(observation: AgentPiToolObservation): "success" | "failure" | "empty" {
  const rawStatus = observation.status;
  if (rawStatus === "success") return "success";
  if (rawStatus === "failure") return "failure";

  const outputAvailability = observation.output_availability;
  if (outputAvailability === "none") return "empty";

  const hasError = observation.error !== undefined;
  if (hasError) return "failure";

  const detail = observation.detail;
  const hasContent = Boolean(
    readObservationSummary(detail) ||
    readAgentNonBlankString(readAgentPiToolObservationArtifactUri(observation)) ||
    detail.evidence.some((entry) => entry.evidence_uri !== undefined),
  );
  return hasContent ? "success" : "empty";
}

function readObservationSummary(detail: AgentPiToolObservation["detail"]): string | undefined {
  return (
    readAgentNonBlankString(detail.semantic_digest) ??
    readAgentNonBlankString(detail.summary) ??
    readAgentNonBlankString(detail.headline)
  );
}

function projectToolCallError(
  error: AgentPiToolObservation["error"],
): AgentPiCompactionToolCallEntry["error"] | undefined {
  if (!error) return undefined;
  const code = readAgentNonBlankString(error.code);
  const kind = readAgentNonBlankString(error.kind);
  const source = readAgentNonBlankString(error.source);
  const message = readAgentNonBlankString(error.message);
  const projected = {
    ...(code ? { code } : {}),
    ...(kind ? { kind } : {}),
    ...(source ? { source } : {}),
    ...(message ? { message } : {}),
  };
  return Object.keys(projected).length > 0 ? projected : undefined;
}

function projectArgumentsPreview(argumentsValue: unknown, tokenBudget: number): string {
  if (argumentsValue === undefined || argumentsValue === null) return "";
  const text = typeof argumentsValue === "string" ? argumentsValue : safeJsonStringify(argumentsValue);
  return new AgentTokenProjector("default").previewText(text, tokenBudget).text;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function aggregateToolCallIndex(
  calls: readonly AgentPiCompactionToolCallEntry[],
  totalCalls: number,
): AgentPiCompactionToolCallIndex {
  return {
    type: AgentPiCompactionToolIndexProtocol.type,
    calls: [...calls],
    totalCalls: Math.max(totalCalls, calls.length),
    successCount: countByStatus(calls, "success"),
    failureCount: countByStatus(calls, "failure"),
    emptyCount: countByStatus(calls, "empty"),
    evidenceUris: uniqueStrings(calls.flatMap((c) => c.evidenceUris)),
    artifactUris: uniqueStrings(calls.flatMap((c) => (c.artifactUri ? [c.artifactUri] : []))),
  };
}

function countByStatus(
  calls: readonly AgentPiCompactionToolCallEntry[],
  status: AgentPiCompactionToolCallEntry["status"],
): number {
  return calls.filter((c) => c.status === status).length;
}
