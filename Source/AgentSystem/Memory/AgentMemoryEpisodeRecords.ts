import type { AgentMemoryCompletedTurnInput, AgentMemoryEpisodeRecord } from "./AgentMemorySourceRepository.js";
import { memoryEpisodeUri, stableMemoryId } from "./AgentMemoryIdentity.js";
import { projectMemoryTime } from "./AgentMemoryTime.js";
import { terminalText } from "./AgentMemoryTerminalText.js";

export function buildEpisode(input: AgentMemoryCompletedTurnInput): AgentMemoryEpisodeRecord {
  const episodeId = stableMemoryId("ep", [input.sessionId, input.requestId]);
  const standaloneRequest = input.userEntry.content;
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
    contextMode: "",
    contextBasis: "",
    topic: standaloneRequest,
    assistantPreview: assistantText,
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
