import { uniqueTrimmed } from "./AgentMemoryCollections.js";
import { memoryCandidateUri, randomMemoryId } from "./AgentMemoryIdentity.js";
import { projectMemoryTime } from "./AgentMemoryTime.js";
import type {
  AgentMemoryCandidateDraft,
  AgentMemoryCandidateRecord,
  AgentMemoryConsolidationActionRecord,
  AgentMemoryDirectWriteInput,
  AgentMemoryEpisodeRecord,
} from "./AgentMemorySourceRepository.js";

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
