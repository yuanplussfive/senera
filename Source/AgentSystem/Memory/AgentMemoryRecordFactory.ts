import {
  AgentConversationEntryKinds,
} from "../AgentConversation.js";
import type { AgentTerminalResult } from "../AgentExecutionProjector.js";
import type { AgentToolEvidenceMemoryEntryRecord } from "../AgentPlannerMemory.js";
import { compactObject } from "../AgentActionPlannerProjectionUtils.js";
import { mergeUnique, uniqueTrimmed } from "./AgentMemoryCollections.js";
import {
  memoryCandidateUri,
  memoryEpisodeUri,
  memoryItemUri,
  memoryObservationUri,
  memorySourceUri,
  randomMemoryId,
  stableMemoryId,
} from "./AgentMemoryIdentity.js";
import { projectMemoryTime } from "./AgentMemoryTime.js";
import type {
  AgentMemoryCandidateDraft,
  AgentMemoryCandidateRecord,
  AgentMemoryCompletedTurnInput,
  AgentMemoryConsolidationActionRecord,
  AgentMemoryDirectWriteInput,
  AgentMemoryEpisodeRecord,
  AgentMemoryItemRecord,
  AgentMemoryLearningActionRecord,
  AgentMemoryObservationRecord,
  AgentMemorySourceKind,
  AgentMemorySourceRecord,
} from "./AgentMemorySourceRepository.js";

export function buildEpisode(input: AgentMemoryCompletedTurnInput): AgentMemoryEpisodeRecord {
  const episodeId = stableMemoryId("ep", [input.sessionId, input.requestId]);
  const standaloneRequest = input.turnUnderstanding?.standaloneRequest?.trim() || input.userEntry.content;
  const assistantText = terminalText(input.terminal);
  const startedTime = projectMemoryTime(input.startedAt);
  const completedTime = projectMemoryTime(input.completedAt);
  return {
    id: episodeId,
    uri: memoryEpisodeUri(episodeId),
    sessionId: input.sessionId,
    requestId: input.requestId,
    status: "completed",
    rawUserText: input.userEntry.content,
    standaloneRequest,
    contextMode: String(input.turnUnderstanding?.contextMode ?? ""),
    contextBasis: input.turnUnderstanding?.contextBasis ?? "",
    topic: standaloneRequest,
    summary: assistantText,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    updatedAt: input.completedAt,
    startedAtMs: startedTime.epochMs,
    completedAtMs: completedTime.epochMs,
    updatedAtMs: completedTime.epochMs,
    timeZone: startedTime.timeZone,
    localDate: startedTime.localDate,
    localHour: startedTime.localHour,
    metadata: {
      terminalKind: input.terminal.kind,
      modelProvider: input.modelProvider,
    },
  };
}

export function buildDirectMemoryAnchor(
  requestId: string | undefined,
  writtenAt: string,
): AgentMemoryEpisodeRecord {
  const normalizedRequestId = requestId?.trim() || "memory_write_anchor";
  const episodeId = stableMemoryId("ep", ["direct-memory-write", normalizedRequestId]);
  const time = projectMemoryTime(writtenAt);
  return {
    id: episodeId,
    uri: memoryEpisodeUri(episodeId),
    sessionId: "",
    requestId: normalizedRequestId,
    status: "memory_anchor",
    rawUserText: "",
    standaloneRequest: "direct memory write",
    contextMode: "",
    contextBasis: "",
    topic: "direct memory write",
    summary: "direct memory write",
    startedAt: writtenAt,
    completedAt: writtenAt,
    updatedAt: writtenAt,
    startedAtMs: time.epochMs,
    completedAtMs: time.epochMs,
    updatedAtMs: time.epochMs,
    timeZone: time.timeZone,
    localDate: time.localDate,
    localHour: time.localHour,
    metadata: {
      kind: "direct_memory_write",
    },
  };
}

export function directWriteAction(input: AgentMemoryDirectWriteInput): AgentMemoryConsolidationActionRecord {
  return {
    operation: input.operation,
    type: input.type,
    subject: input.subject,
    claim: input.claim,
    howToApply: input.howToApply,
    tags: uniqueTrimmed(input.tags),
    triggers: uniqueTrimmed(input.triggers),
    sourceRefs: [],
    candidateUris: [],
    targetMemoryUri: input.targetMemoryUri,
    reason: input.reason?.trim() || "Explicit memory write tool call.",
    confidence: input.confidence,
  };
}

export function buildSources(
  input: AgentMemoryCompletedTurnInput,
  episode: AgentMemoryEpisodeRecord,
): AgentMemorySourceRecord[] {
  const sources: AgentMemorySourceRecord[] = [
    buildSource({
      input,
      episode,
      sourceKind: "user_message",
      role: "user",
      key: input.userEntry.id,
      textContent: input.userEntry.content,
      summary: input.turnUnderstanding?.standaloneRequest ?? input.userEntry.content,
      conversationEntryId: input.userEntry.id,
      createdAt: input.userEntry.timestamp,
    }),
    buildSource({
      input,
      episode,
      sourceKind: "assistant_final",
      role: "assistant",
      key: input.assistantEntry.id,
      textContent: terminalText(input.terminal),
      summary: terminalText(input.terminal),
      conversationEntryId: input.assistantEntry.id,
      createdAt: input.assistantEntry.timestamp,
    }),
  ];

  const artifactSources = new Map<string, AgentMemorySourceRecord>();
  for (const entry of input.conversationEntries) {
    if (entry.kind !== AgentConversationEntryKinds.ToolEvidenceMemory) {
      continue;
    }

    if (entry.record.artifactUri) {
      artifactSources.set(entry.record.artifactUri, buildSource({
        input,
        episode,
        sourceKind: "artifact",
        role: "tool",
        key: entry.record.artifactUri,
        conversationEntryId: entry.id,
        artifactUri: entry.record.artifactUri,
        toolName: entry.record.toolName,
        createdAt: entry.timestamp,
      }));
    }

    for (const evidence of entry.record.evidence) {
      sources.push(buildSource({
        input,
        episode,
        sourceKind: "tool_evidence",
        role: "tool",
        key: evidence.evidenceUri,
        summary: evidence.display || evidence.label || evidence.kind,
        conversationEntryId: entry.id,
        evidenceUri: evidence.evidenceUri,
        artifactUri: evidence.artifactUri,
        toolName: evidence.toolName,
        createdAt: entry.timestamp,
        metadata: {
          evidence: projectMemoryEvidenceSource(evidence),
        },
      }));
    }
  }

  return [...sources, ...artifactSources.values()];
}

export function buildNewMemoryItem(
  episode: AgentMemoryEpisodeRecord,
  action: AgentMemoryConsolidationActionRecord,
  learnedAt: string,
): AgentMemoryItemRecord {
  const id = randomMemoryId("mem");
  const time = projectMemoryTime(learnedAt);
  return {
    id,
    uri: memoryItemUri(id),
    type: action.type,
    subject: action.subject,
    claim: action.claim,
    howToApply: action.howToApply,
    tags: uniqueTrimmed(action.tags),
    triggers: uniqueTrimmed(action.triggers),
    sourceRefs: uniqueTrimmed(action.sourceRefs),
    status: "active",
    confidence: action.confidence,
    sessionId: episode.sessionId,
    sourceEpisodeUri: episode.uri,
    sourceRequestId: episode.requestId,
    createdAt: learnedAt,
    updatedAt: learnedAt,
    createdAtMs: time.epochMs,
    updatedAtMs: time.epochMs,
    timeZone: time.timeZone,
    localDate: time.localDate,
    localHour: time.localHour,
    metadata: {
      learningReason: action.reason,
      operation: action.operation,
    },
  };
}

export function buildUpdatedMemoryItem(
  episode: AgentMemoryEpisodeRecord,
  current: AgentMemoryItemRecord,
  action: AgentMemoryConsolidationActionRecord,
  learnedAt: string,
): AgentMemoryItemRecord {
  const time = projectMemoryTime(learnedAt);
  return {
    ...current,
    type: action.type,
    subject: action.subject,
    claim: action.claim,
    howToApply: action.howToApply,
    tags: mergeUnique(current.tags, action.tags),
    triggers: mergeUnique(current.triggers, action.triggers),
    sourceRefs: mergeUnique(current.sourceRefs, action.sourceRefs),
    status: "active",
    confidence: action.confidence,
    sessionId: episode.sessionId,
    sourceEpisodeUri: episode.uri,
    sourceRequestId: episode.requestId,
    updatedAt: learnedAt,
    updatedAtMs: time.epochMs,
    timeZone: time.timeZone,
    localDate: time.localDate,
    localHour: time.localHour,
    metadata: {
      ...current.metadata,
      learningReason: action.reason,
      operation: action.operation,
    },
  };
}

export function buildReinforcedMemoryItem(
  episode: AgentMemoryEpisodeRecord,
  current: AgentMemoryItemRecord,
  action: AgentMemoryLearningActionRecord,
  learnedAt: string,
): AgentMemoryItemRecord {
  const time = projectMemoryTime(learnedAt);
  return {
    ...current,
    tags: mergeUnique(current.tags, action.tags),
    triggers: mergeUnique(current.triggers, action.triggers),
    sourceRefs: mergeUnique(current.sourceRefs, action.sourceRefs),
    confidence: Math.max(current.confidence, action.confidence),
    sessionId: episode.sessionId,
    sourceEpisodeUri: episode.uri,
    sourceRequestId: episode.requestId,
    updatedAt: learnedAt,
    updatedAtMs: time.epochMs,
    timeZone: time.timeZone,
    localDate: time.localDate,
    localHour: time.localHour,
    metadata: {
      ...current.metadata,
      learningReason: action.reason,
      operation: action.operation,
    },
  };
}

export function buildMemoryObservation(
  episode: AgentMemoryEpisodeRecord,
  memoryUri: string,
  action: AgentMemoryLearningActionRecord,
  observedAt: string,
): AgentMemoryObservationRecord {
  const id = randomMemoryId("obs");
  const time = projectMemoryTime(observedAt);
  return {
    id,
    uri: memoryObservationUri(id),
    memoryUri,
    operation: action.operation,
    candidateUris: actionCandidateUris(action),
    sourceRefs: uniqueTrimmed(action.sourceRefs),
    reason: action.reason,
    confidence: action.confidence,
    sessionId: episode.sessionId,
    sourceEpisodeUri: episode.uri,
    sourceRequestId: episode.requestId,
    createdAt: observedAt,
    createdAtMs: time.epochMs,
    timeZone: time.timeZone,
    localDate: time.localDate,
    localHour: time.localHour,
    metadata: {},
  };
}

export function buildMemoryCandidate(
  episode: AgentMemoryEpisodeRecord,
  candidate: AgentMemoryCandidateDraft,
  learnedAt: string,
): AgentMemoryCandidateRecord {
  const id = randomMemoryId("cand");
  const time = projectMemoryTime(learnedAt);
  return {
    id,
    uri: memoryCandidateUri(id),
    type: candidate.type,
    subject: candidate.subject,
    claim: candidate.claim,
    howToApply: candidate.howToApply,
    tags: uniqueTrimmed(candidate.tags),
    triggers: uniqueTrimmed(candidate.triggers),
    sourceRefs: uniqueTrimmed(candidate.sourceRefs),
    reason: candidate.reason,
    confidence: candidate.confidence,
    embedding: candidate.embedding,
    status: "pending",
    sessionId: episode.sessionId,
    sourceEpisodeUri: episode.uri,
    sourceRequestId: episode.requestId,
    promotedMemoryUri: "",
    createdAt: learnedAt,
    updatedAt: learnedAt,
    createdAtMs: time.epochMs,
    updatedAtMs: time.epochMs,
    timeZone: time.timeZone,
    localDate: time.localDate,
    localHour: time.localHour,
    metadata: {},
  };
}

function buildSource(input: {
  input: AgentMemoryCompletedTurnInput;
  episode: AgentMemoryEpisodeRecord;
  sourceKind: AgentMemorySourceKind;
  role: string;
  key: string;
  textContent?: string;
  summary?: string;
  conversationEntryId: string;
  evidenceUri?: string;
  artifactUri?: string;
  toolName?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}): AgentMemorySourceRecord {
  const id = stableMemoryId("src", [
    input.input.sessionId,
    input.input.requestId,
    input.sourceKind,
    input.key,
  ]);
  const createdTime = projectMemoryTime(input.createdAt);
  return {
    id,
    uri: memorySourceUri(id),
    episodeId: input.episode.id,
    episodeUri: input.episode.uri,
    sessionId: input.input.sessionId,
    requestId: input.input.requestId,
    sourceKind: input.sourceKind,
    role: input.role,
    textContent: input.textContent ?? null,
    summary: input.summary ?? null,
    conversationEntryId: input.conversationEntryId,
    evidenceUri: input.evidenceUri ?? "",
    artifactUri: input.artifactUri ?? "",
    toolName: input.toolName ?? "",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    createdAtMs: createdTime.epochMs,
    updatedAtMs: createdTime.epochMs,
    timeZone: createdTime.timeZone,
    localDate: createdTime.localDate,
    localHour: createdTime.localHour,
    metadata: input.metadata ?? {},
  };
}

function projectMemoryEvidenceSource(
  evidence: AgentToolEvidenceMemoryEntryRecord["evidence"][number],
): Record<string, unknown> {
  return compactObject({
    evidenceUri: evidence.evidenceUri,
    kind: evidence.kind,
    locator: evidence.locator,
    display: evidence.display,
    label: evidence.label,
    toolName: evidence.toolName,
    artifactUri: evidence.artifactUri,
    facts: evidence.facts,
    artifactRefs: evidence.artifactRefs,
  });
}

function actionCandidateUris(action: AgentMemoryLearningActionRecord): string[] {
  const value = (action as Partial<AgentMemoryConsolidationActionRecord>).candidateUris;
  return Array.isArray(value) ? uniqueTrimmed(value) : [];
}

function terminalText(terminal: AgentTerminalResult): string {
  return terminal.kind === "FinalAnswer" ? terminal.content : terminal.question;
}
