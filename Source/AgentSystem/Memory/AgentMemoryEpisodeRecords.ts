import type { AgentMemoryCompletedTurnInput, AgentMemoryEpisodeRecord } from "./AgentMemorySourceRepository.js";
import { memoryEpisodeUri, stableMemoryId } from "./AgentMemoryIdentity.js";
import { projectMemoryTime } from "./AgentMemoryTime.js";
import { terminalText } from "./AgentMemoryTerminalText.js";
import { AgentStateCardSchema } from "../StateCard/AgentStateCardTypes.js";
import { assessToolSearchEpisode } from "../ToolSearch/AgentToolSearchEpisodeScorer.js";

export function buildEpisode(input: AgentMemoryCompletedTurnInput): AgentMemoryEpisodeRecord {
  const episodeId = stableMemoryId("ep", [input.sessionId, input.requestId]);
  const stateCard = AgentStateCardSchema.optional().parse(input.stateCard);
  const standaloneRequest = stateCard?.standaloneRequest.trim() || input.userEntry.content;
  const model = input.modelProvider?.model;
  if (!model?.trim()) throw new Error("Completed turn memory requires the resolved model identity.");
  const assistantText = terminalText(input.terminal);
  const startedTime = projectMemoryTime(input.startedAt);
  const completedTime = projectMemoryTime(input.completedAt);
  const { calls } = assessToolSearchEpisode(input.executedTools);
  return {
    id: episodeId,
    uri: memoryEpisodeUri(episodeId),
    sessionId: input.sessionId,
    requestId: input.requestId,
    status: "completed",
    rawUserText: input.userEntry.content,
    standaloneRequest,
    contextBasis: stateCard?.topicRelation ?? "",
    topic: standaloneRequest,
    assistantText,
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
      toolHistory: {
        tools: calls.map((call) => ({ name: call.toolName, status: call.status })),
        artifacts: [...new Set(calls.flatMap((call) => [...call.artifactUris, ...call.evidenceUris]))],
      },
      ...(stateCard ? { stateCard } : {}),
    },
  };
}
