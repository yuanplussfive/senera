import type {
  AgentMemoryConsolidationPromptInput,
  AgentMemoryLearningPromptInput,
} from "../ActionPlanner/AgentLearningPromptJson.js";
import { encodePlannerTimelinePayload } from "../ActionPlanner/AgentPlannerTimelinePayload.js";
import {
  AgentMemoryTypes,
  type AgentMemoryCandidateRecord,
  type AgentMemoryItemRecord,
  type AgentMemoryRecordedTurn,
  type AgentMemorySourceKind,
  type AgentMemorySourceRecord,
} from "./AgentMemorySourceRepository.js";

const MemoryLearningSourcePolicies = {
  user_message: {
    memoryRole: "support",
    timelineRole: "user",
    timelineKind: "memory_user_message",
  },
  assistant_final: {
    memoryRole: "context",
    timelineRole: "assistant",
    timelineKind: "memory_assistant_context",
  },
  tool_evidence: {
    memoryRole: "support",
    timelineRole: "user",
    timelineKind: "memory_tool_evidence",
  },
  artifact: {
    memoryRole: "support",
    timelineRole: "user",
    timelineKind: "memory_artifact",
  },
} as const satisfies Record<AgentMemorySourceKind, {
  memoryRole: "support" | "context";
  timelineRole: "user" | "assistant";
  timelineKind: string;
}>;

export function buildMemoryLearningPromptInput(
  recordedTurn: AgentMemoryRecordedTurn,
): AgentMemoryLearningPromptInput {
  const sources = recordedTurn.sources.map(projectSource);
  return {
    memoryTypes: [...AgentMemoryTypes],
    episode: projectEpisode(recordedTurn),
    timeline: [...recordedTurn.sources]
      .sort((left, right) => left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id))
      .map(projectTimelineSource),
    sourceCatalog: sources,
    supportingSourceRefs: sources
      .filter((source) => source.memoryRole === "support")
      .map((source) => source.sourceRef),
    contextSourceRefs: sources
      .filter((source) => source.memoryRole === "context")
      .map((source) => source.sourceRef),
  };
}

export function buildMemoryConsolidationPromptInput(
  recordedTurn: AgentMemoryRecordedTurn,
  candidates: readonly AgentMemoryCandidateRecord[],
  existingMemories: readonly AgentMemoryItemRecord[],
): AgentMemoryConsolidationPromptInput {
  return {
    memoryTypes: [...AgentMemoryTypes],
    episode: projectEpisode(recordedTurn),
    candidates: candidates.map(projectCandidate),
    existingMemories: existingMemories.map(projectExistingMemory),
  };
}

export function candidateSourceRefs(
  candidates: readonly AgentMemoryCandidateRecord[],
): ReadonlyMap<string, readonly string[]> {
  return new Map(candidates.map((candidate) => [candidate.uri, candidate.sourceRefs]));
}

function projectEpisode(recordedTurn: AgentMemoryRecordedTurn): AgentMemoryLearningPromptInput["episode"] {
  return {
    episodeUri: recordedTurn.episode.uri,
    requestId: recordedTurn.episode.requestId,
    standaloneRequest: recordedTurn.episode.standaloneRequest,
    contextMode: recordedTurn.episode.contextMode,
    contextBasis: recordedTurn.episode.contextBasis,
    startedAt: recordedTurn.episode.startedAt,
    completedAt: recordedTurn.episode.completedAt,
    localDate: recordedTurn.episode.localDate,
    localHour: recordedTurn.episode.localHour,
  };
}

function projectSource(source: AgentMemorySourceRecord): AgentMemoryLearningPromptInput["sourceCatalog"][number] {
  const policy = MemoryLearningSourcePolicies[source.sourceKind];
  return {
    sourceRef: source.uri,
    sourceKind: source.sourceKind,
    role: source.role,
    memoryRole: policy.memoryRole,
    evidenceUri: source.evidenceUri,
    artifactUri: source.artifactUri,
    toolName: source.toolName,
    createdAt: source.createdAt,
  };
}

function projectTimelineSource(
  source: AgentMemorySourceRecord,
  index: number,
): AgentMemoryLearningPromptInput["timeline"][number] {
  const policy = MemoryLearningSourcePolicies[source.sourceKind];
  return {
    index,
    role: policy.timelineRole,
    kind: policy.timelineKind,
    content: source.summary ?? source.textContent ?? "",
    payloadJson: encodePlannerTimelinePayload({
      sourceRef: source.uri,
      sourceKind: source.sourceKind,
      sourceRole: source.role,
      memoryRole: policy.memoryRole,
      content: source.textContent ?? undefined,
      summary: source.summary ?? undefined,
      evidenceUri: source.evidenceUri || undefined,
      artifactUri: source.artifactUri || undefined,
      toolName: source.toolName || undefined,
      metadata: source.metadata,
      createdAt: source.createdAt,
    }),
    evidenceUris: source.evidenceUri ? [source.evidenceUri] : [],
    artifactUris: source.artifactUri ? [source.artifactUri] : [],
  };
}

function projectCandidate(
  candidate: AgentMemoryCandidateRecord,
): AgentMemoryConsolidationPromptInput["candidates"][number] {
  return {
    uri: candidate.uri,
    type: candidate.type,
    subject: candidate.subject,
    claim: candidate.claim,
    howToApply: candidate.howToApply,
    tags: candidate.tags,
    triggers: candidate.triggers,
    sourceRefs: candidate.sourceRefs,
    reason: candidate.reason,
    confidence: candidate.confidence,
    createdAt: candidate.createdAt,
  };
}

function projectExistingMemory(
  memory: AgentMemoryItemRecord,
): AgentMemoryConsolidationPromptInput["existingMemories"][number] {
  return {
    uri: memory.uri,
    type: memory.type,
    subject: memory.subject,
    claim: memory.claim,
    howToApply: memory.howToApply,
    tags: memory.tags,
    triggers: memory.triggers,
    confidence: memory.confidence,
    updatedAt: memory.updatedAt,
  };
}
