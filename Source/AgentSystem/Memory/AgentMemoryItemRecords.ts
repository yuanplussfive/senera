import { mergeUnique, uniqueTrimmed } from "./AgentMemoryCollections.js";
import { memoryItemUri, memoryObservationUri, randomMemoryId } from "./AgentMemoryIdentity.js";
import { projectMemoryTime } from "./AgentMemoryTime.js";
import type {
  AgentMemoryConsolidationActionRecord,
  AgentMemoryEpisodeRecord,
  AgentMemoryItemRecord,
  AgentMemoryLearningActionRecord,
  AgentMemoryObservationRecord,
} from "./AgentMemorySourceRepository.js";

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

function actionCandidateUris(action: AgentMemoryLearningActionRecord): string[] {
  const value = (action as Partial<AgentMemoryConsolidationActionRecord>).candidateUris;
  return Array.isArray(value) ? uniqueTrimmed(value) : [];
}
