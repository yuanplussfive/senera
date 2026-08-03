import type {
  AgentMemoryEpisodeRecord,
  AgentMemoryItemRecord,
  AgentMemorySourceRecord,
} from "./AgentMemorySourceRepository.js";
import type {
  ConversationRecallRankedEntry,
  MemoryRecallRankedEntry,
  MemoryRecallResultEntry,
  MemoryRecallSourceEntry,
  MemoryRecallTurnEntry,
} from "./AgentMemoryRecallTypes.js";
import { unique } from "./AgentMemoryRecallUtils.js";

export function projectMemoryResult(
  item: AgentMemoryItemRecord,
  ranked: MemoryRecallRankedEntry & { matchedBy: string[] },
): MemoryRecallResultEntry {
  return {
    memoryUri: item.uri,
    type: item.type,
    subject: item.subject,
    claim: item.claim,
    howToApply: item.howToApply,
    tags: { item: item.tags },
    triggers: { item: item.triggers },
    sourceRefs: { item: item.sourceRefs },
    matchedBy: { item: ranked.matchedBy },
    score: Number(ranked.score.toFixed(6)),
    confidence: Number(item.confidence.toFixed(6)),
    updatedAt: item.updatedAt,
    localDate: item.localDate,
  };
}

export function projectConversationTurnResult(
  episode: AgentMemoryEpisodeRecord,
  sources: readonly AgentMemorySourceRecord[],
  ranked: ConversationRecallRankedEntry & { matchedBy: string[] },
): MemoryRecallTurnEntry {
  const userSource = sources.find((source) => source.sourceKind === "user_message");
  const assistantSource = sources.find((source) => source.sourceKind === "assistant_final");
  return {
    episodeUri: episode.uri,
    requestId: episode.requestId,
    userMessage: {
      sourceRef: userSource?.uri ?? "",
      text: userSource?.textContent ?? episode.rawUserText,
      summary: userSource?.summary ?? episode.standaloneRequest,
    },
    assistantMessage: {
      sourceRef: assistantSource?.uri ?? "",
      text: assistantSource?.textContent ?? episode.summary,
      summary: assistantSource?.summary ?? episode.summary,
    },
    sourceRefs: {
      item: unique(sources.map((source) => source.uri)),
    },
    matchedBy: {
      item: ranked.matchedBy,
    },
    score: Number(ranked.score.toFixed(6)),
    startedAt: episode.startedAt,
    completedAt: episode.completedAt,
    localDate: episode.localDate,
  };
}

export function projectSourceResult(source: AgentMemorySourceRecord): MemoryRecallSourceEntry {
  return {
    sourceRef: source.uri,
    sourceKind: source.sourceKind,
    role: source.role,
    summary: source.summary ?? "",
    evidenceUri: source.evidenceUri,
    artifactUri: source.artifactUri,
    toolName: source.toolName,
    createdAt: source.createdAt,
    localDate: source.localDate,
  };
}

export function memoryRecallGuidance(
  memories: readonly MemoryRecallResultEntry[],
  turns: readonly MemoryRecallTurnEntry[],
): string {
  if (memories.length > 0) {
    return "Use recalled memories as durable user/project context. Cite sourceRefs when explaining why a memory applies.";
  }
  if (turns.length > 0) {
    return "No active long-term memory matched. Use returned conversation turns as historical context, not as durable preference or knowledge unless the quoted user/assistant text directly supports it.";
  }
  return "No active long-term memory or ordinary conversation memory matched this query.";
}

export function fallbackReason(
  memories: readonly MemoryRecallResultEntry[],
  turns: readonly MemoryRecallTurnEntry[],
): string {
  if (memories.length > 0) {
    return "";
  }
  return turns.length > 0
    ? "No active long-term memory matched; searched ordinary conversation memory instead."
    : "No active long-term memory matched; ordinary conversation memory search also returned no matches.";
}
