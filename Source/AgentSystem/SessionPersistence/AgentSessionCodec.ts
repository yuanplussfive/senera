import {
  AgentConversationEntryKinds,
  type AgentConversationEntry,
} from "../AgentConversation.js";
import type { AgentEventEnvelope } from "../AgentEventBase.js";
import type {
  AgentConversationEntryMetadata,
  AgentModelProviderMetadata,
} from "../AgentModelMetadata.js";
import {
  AgentUploadAttachmentListSchema,
  type AgentUploadAttachment,
} from "../Uploads/AgentUploadTypes.js";
import { ToolCallStatus } from "../BamlClient/baml_client/types.js";
import type {
  StoredRunSnapshot,
  StoredRunSnapshotStatus,
} from "../AgentSqliteSessionRepository.js";
import type {
  EntryRow,
  RunSnapshotRow,
} from "./AgentSessionSqlRows.js";

export function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function parseStoredRunEvent(value: string): AgentEventEnvelope | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }

    const record = parsed as Partial<AgentEventEnvelope>;
    return typeof record.kind === "string"
      && typeof record.timestamp === "string"
      && typeof record.sequence === "number"
      && typeof record.channel === "string"
      ? record as AgentEventEnvelope
      : undefined;
  } catch {
    return undefined;
  }
}

export function entryToRow(
  sessionId: string,
  entry: AgentConversationEntry,
  sequence: number,
): {
  id: string;
  session_id: string;
  request_id: string;
  kind: string;
  timestamp: string;
  sequence: number;
  data: string;
} {
  const data: Record<string, unknown> = {};
  switch (entry.kind) {
    case AgentConversationEntryKinds.UserMessage:
      data.content = entry.content;
      if (entry.attachments && entry.attachments.length > 0) {
        data.attachments = entry.attachments;
      }
      break;
    case AgentConversationEntryKinds.AssistantDecision:
    case AgentConversationEntryKinds.ContextToolResults:
      data.xml = entry.xml;
      break;
    case AgentConversationEntryKinds.PlannerJournal:
    case AgentConversationEntryKinds.PlannerStateSnapshot:
    case AgentConversationEntryKinds.ToolEvidenceMemory:
      data.record = entry.record;
      break;
  }
  if (entry.metadata) {
    data.metadata = entry.metadata;
  }
  return {
    id: entry.id,
    session_id: sessionId,
    request_id: entry.requestId,
    kind: entry.kind,
    timestamp: entry.timestamp,
    sequence,
    data: JSON.stringify(data),
  };
}

export function rowToEntry(row: EntryRow): AgentConversationEntry {
  const data = JSON.parse(row.data) as {
    content?: string;
    attachments?: unknown;
    xml?: string;
    record?: unknown;
    metadata?: unknown;
  };
  const base = {
    id: row.id,
    requestId: row.request_id,
    timestamp: row.timestamp,
  };
  switch (row.kind) {
    case AgentConversationEntryKinds.UserMessage:
      return {
        ...base,
        kind: AgentConversationEntryKinds.UserMessage,
        content: data.content ?? "",
        attachments: parseUploadAttachments(data.attachments),
        metadata: parseEntryMetadata(data.metadata),
      };
    case AgentConversationEntryKinds.AssistantDecision:
      return {
        ...base,
        kind: AgentConversationEntryKinds.AssistantDecision,
        xml: data.xml ?? "",
        metadata: parseEntryMetadata(data.metadata),
      };
    case AgentConversationEntryKinds.ContextToolResults:
      return {
        ...base,
        kind: AgentConversationEntryKinds.ContextToolResults,
        xml: data.xml ?? "",
        metadata: parseEntryMetadata(data.metadata),
      };
    case AgentConversationEntryKinds.PlannerJournal:
      return {
        ...base,
        kind: AgentConversationEntryKinds.PlannerJournal,
        record: parsePlannerJournalRecord(data.record, row.request_id, row.timestamp),
        metadata: parseEntryMetadata(data.metadata),
      };
    case AgentConversationEntryKinds.PlannerStateSnapshot:
      return {
        ...base,
        kind: AgentConversationEntryKinds.PlannerStateSnapshot,
        record: parsePlannerStateSnapshotRecord(data.record, row.request_id, row.timestamp),
        metadata: parseEntryMetadata(data.metadata),
      };
    case AgentConversationEntryKinds.ToolEvidenceMemory:
      return {
        ...base,
        kind: AgentConversationEntryKinds.ToolEvidenceMemory,
        record: parseToolEvidenceMemoryRecord(data.record, row.request_id, row.timestamp),
        metadata: parseEntryMetadata(data.metadata),
      };
    default:
      throw new Error(`未知 conversation entry kind: ${row.kind}`);
  }
}

export function runSnapshotToRow(snapshot: StoredRunSnapshot): {
  session_id: string;
  request_id: string;
  input: string;
  status: StoredRunSnapshotStatus;
  started_at: string;
  updated_at: string;
  ended_at: string | null;
  error_message: string | null;
  model_provider: string | null;
} {
  return {
    session_id: snapshot.sessionId,
    request_id: snapshot.requestId,
    input: snapshot.input,
    status: snapshot.status,
    started_at: snapshot.startedAt,
    updated_at: snapshot.updatedAt,
    ended_at: snapshot.endedAt ?? null,
    error_message: snapshot.errorMessage ?? null,
    model_provider: snapshot.modelProvider ? JSON.stringify(snapshot.modelProvider) : null,
  };
}

export function rowToRunSnapshot(row: RunSnapshotRow): StoredRunSnapshot {
  return {
    sessionId: row.session_id,
    requestId: row.request_id,
    input: row.input,
    status: parseRunSnapshotStatus(row.status),
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    endedAt: row.ended_at ?? undefined,
    errorMessage: row.error_message ?? undefined,
    modelProvider: parseModelProviderMetadata(row.model_provider),
  };
}

function parseEntryMetadata(value: unknown): AgentConversationEntryMetadata | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as AgentConversationEntryMetadata
    : undefined;
}

function parseUploadAttachments(value: unknown): AgentUploadAttachment[] | undefined {
  const parsed = AgentUploadAttachmentListSchema.safeParse(value);
  return parsed.success && parsed.data.length > 0 ? parsed.data : undefined;
}

function parsePlannerJournalRecord(
  value: unknown,
  requestId: string,
  timestamp: string,
): import("../AgentPlannerMemory.js").AgentPlannerJournalEntryRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      requestId,
      step: 0,
      selectedAction: "unknown",
      decision: {},
      evidenceUris: [],
      artifactUris: [],
      loadedTools: [],
      result: "unknown",
      createdAt: timestamp,
    };
  }

  const record = value as Record<string, unknown>;
  return {
    requestId: readStringField(record.requestId) || requestId,
    step: readNumberField(record.step),
    selectedAction: readStringField(record.selectedAction) || "unknown",
    decision: record.decision ?? {},
    evidenceUris: readStringArray(record.evidenceUris),
    artifactUris: readStringArray(record.artifactUris),
    loadedTools: readStringArray(record.loadedTools),
    result: readStringField(record.result) || "unknown",
    createdAt: readStringField(record.createdAt) || timestamp,
  };
}

function parseToolEvidenceMemoryRecord(
  value: unknown,
  requestId: string,
  timestamp: string,
): import("../AgentPlannerMemory.js").AgentToolEvidenceMemoryEntryRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      requestId,
      step: 0,
      toolName: "",
      artifactId: "",
      artifactUri: "",
      artifactPath: "",
      evidence: [],
      createdAt: timestamp,
    };
  }

  const record = value as Record<string, unknown>;
  return {
    requestId: readStringField(record.requestId) || requestId,
    step: readNumberField(record.step),
    toolName: readStringField(record.toolName),
    artifactId: readStringField(record.artifactId),
    artifactUri: readStringField(record.artifactUri),
    artifactPath: readStringField(record.artifactPath),
    evidence: readEvidenceMemoryItems(record.evidence),
    createdAt: readStringField(record.createdAt) || timestamp,
  };
}

function parsePlannerStateSnapshotRecord(
  value: unknown,
  requestId: string,
  timestamp: string,
): import("../AgentPlannerState.js").AgentPlannerStateSnapshotRecord {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  return {
    taskId: readStringField(record.taskId) || requestId,
    requestId: readStringField(record.requestId) || requestId,
    step: readNumberField(record.step),
    status: readPlannerStateStatus(record.status),
    userGoal: readStringField(record.userGoal),
    currentIntent: readStringField(record.currentIntent),
    intentTags: readStringArray(record.intentTags),
    taskTags: readStringArray(record.taskTags),
    targetRefs: readPlannerStateTargetRefs(record.targetRefs),
    requiredEffects: readPlannerStateEffects(record.requiredEffects),
    evidenceNeeds: readPlannerStateEvidenceNeeds(record.evidenceNeeds),
    completedEvidence: readPlannerStateEvidence(record.completedEvidence),
    completedEffects: readPlannerStateEffects(record.completedEffects),
    openQuestions: readPlannerStateOpenQuestions(record.openQuestions),
    candidateTools: readPlannerStateCandidateTools(record.candidateTools),
    discoveryQueries: readStringArray(record.discoveryQueries),
    nextStepPurpose: readStringField(record.nextStepPurpose),
    completionCriteria: readStringArray(record.completionCriteria),
    lastAction: readPlannerActionKind(record.lastAction),
    loadedTools: readStringArray(record.loadedTools),
    recentCalls: readPlannerStateRecentCalls(record.recentCalls),
    updatedAt: readStringField(record.updatedAt) || timestamp,
  };
}

function readPlannerStateStatus(
  value: unknown,
): import("../AgentPlannerState.js").AgentPlannerTaskStatus {
  return value === "waiting_for_user" || value === "ready_to_answer" ? value : "running";
}

function readPlannerStateTargetRefs(
  value: unknown,
): import("../AgentPlannerState.js").AgentPlannerStateTargetRef[] {
  return readRecords(value).map((record) => ({
    kind: readStringField(record.kind),
    value: readStringField(record.value),
    status: readStringField(record.status),
  }));
}

function readPlannerStateEffects(
  value: unknown,
): import("../AgentPlannerState.js").AgentPlannerStateEffect[] {
  return readRecords(value).map((record) => ({
    id: readStringField(record.id),
    effect: readStringField(record.effect),
    target: readStringField(record.target),
    reason: readStringField(record.reason),
  }));
}

function readPlannerStateEvidenceNeeds(
  value: unknown,
): import("../AgentPlannerState.js").AgentPlannerStateEvidenceNeed[] {
  return readRecords(value).map((record) => ({
    id: readStringField(record.id),
    need: readStringField(record.need),
    scope: readStringField(record.scope),
    minimum: readNumberField(record.minimum),
    reason: readStringField(record.reason),
  }));
}

function readPlannerStateEvidence(
  value: unknown,
): import("../AgentPlannerState.js").AgentPlannerStateEvidence[] {
  return readRecords(value).map((record) => ({
    evidenceUri: readStringField(record.evidenceUri),
    kind: readStringField(record.kind),
    toolName: readStringField(record.toolName),
    artifactUri: readStringField(record.artifactUri),
    locator: readStringField(record.locator),
    display: readStringField(record.display),
    label: readStringField(record.label),
  }));
}

function readPlannerStateOpenQuestions(
  value: unknown,
): import("../AgentPlannerState.js").AgentPlannerStateOpenQuestion[] {
  return readRecords(value).map((record) => ({
    question: readStringField(record.question),
    reason: readStringField(record.reason),
  }));
}

function readPlannerStateCandidateTools(
  value: unknown,
): import("../AgentPlannerState.js").AgentPlannerStateCandidateTool[] {
  return readRecords(value).map((record) => ({
    name: readStringField(record.name),
    purpose: readStringField(record.purpose),
    supports: readStringArray(record.supports),
  }));
}

function readPlannerStateRecentCalls(
  value: unknown,
): import("../BamlClient/baml_client/types.js").PlannerToolCallStateItem[] {
  return readRecords(value).map((record) => ({
    step: readNumberField(record.step),
    toolName: readStringField(record.toolName),
    status: readPlannerToolCallStatus(record.status),
    artifactUri: readStringField(record.artifactUri),
    evidenceUris: readStringArray(record.evidenceUris),
    resultKind: readStringField(record.resultKind),
    argumentsPreview: readStringField(record.argumentsPreview),
    error: readStringField(record.error),
  }));
}

function readPlannerToolCallStatus(value: unknown): ToolCallStatus {
  if (value === ToolCallStatus.Failure) {
    return ToolCallStatus.Failure;
  }
  if (value === ToolCallStatus.Empty) {
    return ToolCallStatus.Empty;
  }
  return ToolCallStatus.Success;
}

function readPlannerActionKind(
  value: unknown,
): import("../AgentActionPlannerTypes.js").AgentActionDecision["action"] {
  if (value === "ask_user" || value === "discover_tools" || value === "use_tools") {
    return value;
  }
  return "answer";
}

function readEvidenceMemoryItems(
  value: unknown,
): import("../BamlClient/baml_client/types.js").PlannerEvidenceMemoryItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(readEvidenceMemoryItem)
    .filter((entry): entry is import("../BamlClient/baml_client/types.js").PlannerEvidenceMemoryItem =>
      Boolean(entry));
}

function readEvidenceMemoryItem(
  value: unknown,
): import("../BamlClient/baml_client/types.js").PlannerEvidenceMemoryItem | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const evidenceUri = readStringField(record.evidenceUri);
  const kind = readStringField(record.kind);
  if (!evidenceUri || !kind) {
    return undefined;
  }

  return {
    evidenceUri,
    kind,
    locator: readStringField(record.locator),
    display: readStringField(record.display),
    label: readStringField(record.label),
    toolName: readStringField(record.toolName),
    artifactUri: readStringField(record.artifactUri),
    facts: readEvidenceFacts(record.facts),
    artifactRefs: readStringArray(record.artifactRefs),
  };
}

function readEvidenceFacts(
  value: unknown,
): import("../BamlClient/baml_client/types.js").EvidenceSlot[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }

    const record = entry as Record<string, unknown>;
    const name = readStringField(record.name);
    const slotValue = readStringField(record.value);
    return name && slotValue ? [{ name, value: slotValue }] : [];
  });
}

function readRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> =>
        Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
    : [];
}

function readStringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readNumberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function parseRunSnapshotStatus(raw: string): StoredRunSnapshotStatus {
  if (raw === "running" || raw === "completed" || raw === "failed" || raw === "cancelled") {
    return raw;
  }
  return "failed";
}

function parseModelProviderMetadata(value: string | null): AgentModelProviderMetadata | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as AgentModelProviderMetadata
      : undefined;
  } catch {
    return undefined;
  }
}
