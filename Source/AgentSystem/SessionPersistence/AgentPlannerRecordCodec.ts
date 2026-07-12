import type { EvidenceSlot, PlannerEvidenceMemoryItem } from "../BamlClient/baml_client/types.js";
import type {
  AgentPlannerJournalEntryRecord,
  AgentToolEvidenceMemoryEntryRecord,
} from "../Memory/AgentPlannerMemory.js";
import { readNumberField, readStringArray, readStringField } from "./AgentSessionJsonCodec.js";

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

function readEvidenceMemoryItems(value: unknown): PlannerEvidenceMemoryItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(readEvidenceMemoryItem).filter((entry): entry is PlannerEvidenceMemoryItem => Boolean(entry));
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
