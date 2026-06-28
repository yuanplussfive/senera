import { ToolCallStatus } from "../BamlClient/baml_client/types.js";
import type { AgentActionDecision } from "../ActionPlanner/AgentActionPlannerTypes.js";
import type {
  EvidenceSlot,
  PlannerEvidenceMemoryItem,
  PlannerToolCallStateItem,
} from "../BamlClient/baml_client/types.js";
import type {
  AgentPlannerStateCandidateTool,
  AgentPlannerStateEffect,
  AgentPlannerStateEvidence,
  AgentPlannerStateEvidenceNeed,
  AgentPlannerStateOpenQuestion,
  AgentPlannerStateSnapshotRecord,
  AgentPlannerStateTargetRef,
  AgentPlannerTaskStatus,
} from "../AgentPlannerState.js";
import type {
  AgentPlannerJournalEntryRecord,
  AgentToolEvidenceMemoryEntryRecord,
} from "../Memory/AgentPlannerMemory.js";
import {
  readNumberField,
  readRecords,
  readStringArray,
  readStringField,
} from "./AgentSessionJsonCodec.js";

export function parsePlannerJournalRecord(
  value: unknown,
  requestId: string,
  timestamp: string,
): AgentPlannerJournalEntryRecord {
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

export function parseToolEvidenceMemoryRecord(
  value: unknown,
  requestId: string,
  timestamp: string,
): AgentToolEvidenceMemoryEntryRecord {
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

export function parsePlannerStateSnapshotRecord(
  value: unknown,
  requestId: string,
  timestamp: string,
): AgentPlannerStateSnapshotRecord {
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

function readPlannerStateStatus(value: unknown): AgentPlannerTaskStatus {
  return value === "waiting_for_user" || value === "ready_to_answer" ? value : "running";
}

function readPlannerStateTargetRefs(value: unknown): AgentPlannerStateTargetRef[] {
  return readRecords(value).map((record) => ({
    kind: readStringField(record.kind),
    value: readStringField(record.value),
    status: readStringField(record.status),
  }));
}

function readPlannerStateEffects(value: unknown): AgentPlannerStateEffect[] {
  return readRecords(value).map((record) => ({
    id: readStringField(record.id),
    effect: readStringField(record.effect),
    target: readStringField(record.target),
    reason: readStringField(record.reason),
  }));
}

function readPlannerStateEvidenceNeeds(value: unknown): AgentPlannerStateEvidenceNeed[] {
  return readRecords(value).map((record) => ({
    id: readStringField(record.id),
    need: readStringField(record.need),
    scope: readStringField(record.scope),
    minimum: readNumberField(record.minimum),
    reason: readStringField(record.reason),
  }));
}

function readPlannerStateEvidence(value: unknown): AgentPlannerStateEvidence[] {
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

function readPlannerStateOpenQuestions(value: unknown): AgentPlannerStateOpenQuestion[] {
  return readRecords(value).map((record) => ({
    question: readStringField(record.question),
    reason: readStringField(record.reason),
  }));
}

function readPlannerStateCandidateTools(value: unknown): AgentPlannerStateCandidateTool[] {
  return readRecords(value).map((record) => ({
    name: readStringField(record.name),
    purpose: readStringField(record.purpose),
    supports: readStringArray(record.supports),
  }));
}

function readPlannerStateRecentCalls(value: unknown): PlannerToolCallStateItem[] {
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

function readPlannerActionKind(value: unknown): AgentActionDecision["action"] {
  if (value === "ask_user" || value === "discover_tools" || value === "use_tools") {
    return value;
  }
  return "answer";
}

function readEvidenceMemoryItems(value: unknown): PlannerEvidenceMemoryItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(readEvidenceMemoryItem)
    .filter((entry): entry is PlannerEvidenceMemoryItem => Boolean(entry));
}

function readEvidenceMemoryItem(value: unknown): PlannerEvidenceMemoryItem | undefined {
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

function readEvidenceFacts(value: unknown): EvidenceSlot[] {
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

