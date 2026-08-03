import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { defineSeneraProtocol } from "../Core/AgentProtocolIdentity.js";
import { uniqueStrings } from "../Core/AgentCollections.js";
import { readAgentNonBlankString, readAgentUnknownRecord, type AgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import { AgentTokenProjector } from "../Text/AgentTokenProjection.js";
import {
  assertAgentPiToolObservationBounded,
  readAgentPiMessageTextContent,
  readAgentPiToolObservation,
  isAgentPiToolResultMessage,
} from "./AgentPiToolObservation.js";
import { parseAgentPiToolDetails } from "./AgentPiToolResultDetails.js";
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

interface PendingToolCall {
  callId: string;
  toolName: string;
  argumentsPreview: string;
  observation?: AgentUnknownRecord;
}

interface ResolvedToolCall extends PendingToolCall {
  observation: AgentUnknownRecord;
}

function extractToolCallEntries(
  messages: readonly AgentMessage[],
  limits: AgentPiCompactionToolIndexLimits,
): AgentPiCompactionToolCallEntry[] {
  const callsById = new Map<string, PendingToolCall>();

  for (const message of messages) {
    const record = readAgentUnknownRecord(message);
    if (!record) continue;

    collectAssistantToolCalls(record, callsById, limits);
    enrichWithToolResult(message, record, callsById);
  }

  return [...callsById.values()]
    .filter((pending): pending is ResolvedToolCall => pending.toolName.length > 0 && pending.observation !== undefined)
    .map((call) => projectToolCallEntry(call));
}

function collectAssistantToolCalls(
  record: AgentUnknownRecord,
  callsById: Map<string, PendingToolCall>,
  limits: AgentPiCompactionToolIndexLimits,
): void {
  const content = Array.isArray(record.content) ? record.content : [];
  for (const block of content) {
    const blockRecord = readAgentUnknownRecord(block);
    if (blockRecord?.type !== "toolCall") continue;
    const callId = readAgentNonBlankString(blockRecord.id);
    const toolName = readAgentNonBlankString(blockRecord.name);
    if (!callId || !toolName) continue;
    callsById.set(callId, {
      callId,
      toolName,
      argumentsPreview: projectArgumentsPreview(blockRecord.arguments, limits.argumentsPreviewTokenBudget),
    });
  }
}

function enrichWithToolResult(
  message: AgentMessage,
  record: AgentUnknownRecord,
  callsById: Map<string, PendingToolCall>,
): void {
  if (!isAgentPiToolResultMessage(message)) return;
  const callId = readAgentNonBlankString(record.toolCallId);
  if (!callId) return;

  const text = readAgentPiMessageTextContent(message);
  const parsedObservation = readAgentPiToolObservation(text);
  if (parsedObservation) assertAgentPiToolObservationBounded(parsedObservation);
  const observation = parsedObservation ?? {};
  const details = parseAgentPiToolDetails(record.details)?.senera;
  const pending = callsById.get(callId);
  if (pending) {
    pending.observation = observation;
    if (details?.toolName && !pending.toolName) pending.toolName = details.toolName;
  } else {
    callsById.set(callId, {
      callId,
      toolName: details?.toolName ?? readAgentNonBlankString(record.toolName) ?? "",
      argumentsPreview: "",
      observation,
    });
  }
}

function projectToolCallEntry(call: ResolvedToolCall): AgentPiCompactionToolCallEntry {
  const obs = call.observation;
  const detail = readAgentUnknownRecord(obs.detail);
  const status = resolveEntryStatus(obs);
  const summaryText = readObservationSummary(detail);
  const artifactUriValue = readAgentNonBlankString(obs.artifact_uri);
  const evidenceUriList = uniqueStrings(readEvidenceUriList(detail?.evidence));
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

function resolveEntryStatus(observation: AgentUnknownRecord): "success" | "failure" | "empty" {
  const rawStatus = readAgentNonBlankString(observation.status);
  if (rawStatus === "success") return "success";
  if (rawStatus === "failure") return "failure";

  const outputAvailability = readAgentNonBlankString(observation.output_availability);
  if (outputAvailability === "none" || outputAvailability === "empty") return "empty";

  const hasError = Boolean(readAgentUnknownRecord(observation.error));
  if (hasError) return "failure";

  const detail = readAgentUnknownRecord(observation.detail);
  const hasContent = Boolean(
    readObservationSummary(detail) ||
    readAgentNonBlankString(observation.artifact_uri) ||
    readEvidenceUriList(detail?.evidence).length > 0,
  );
  return hasContent ? "success" : "empty";
}

function readObservationSummary(detail: AgentUnknownRecord | undefined): string | undefined {
  return readAgentNonBlankString(detail?.semantic_digest ?? detail?.summary ?? detail?.headline);
}

function projectToolCallError(errorValue: unknown): AgentPiCompactionToolCallEntry["error"] | undefined {
  const error = readAgentUnknownRecord(errorValue);
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

function readEvidenceUriList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = readAgentUnknownRecord(entry);
    const uri = readAgentNonBlankString(record?.evidence_uri ?? record?.evidenceUri);
    return uri ? [uri] : [];
  });
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
