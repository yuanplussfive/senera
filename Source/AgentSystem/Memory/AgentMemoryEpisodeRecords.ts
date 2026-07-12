import type { AgentMemoryCompletedTurnInput, AgentMemoryEpisodeRecord } from "./AgentMemorySourceRepository.js";
import { memoryEpisodeUri, stableMemoryId } from "./AgentMemoryIdentity.js";
import { projectMemoryTime } from "./AgentMemoryTime.js";
import { terminalText } from "./AgentMemoryTerminalText.js";

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

export function buildDirectMemoryAnchor(requestId: string | undefined, writtenAt: string): AgentMemoryEpisodeRecord {
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
