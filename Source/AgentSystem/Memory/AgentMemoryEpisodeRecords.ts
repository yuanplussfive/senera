import type { AgentMemoryCompletedTurnInput, AgentMemoryEpisodeRecord } from "./AgentMemorySourceRepository.js";
import { z } from "zod";
import { memoryEpisodeUri, stableMemoryId } from "./AgentMemoryIdentity.js";
import { projectMemoryTime } from "./AgentMemoryTime.js";
import { terminalText } from "./AgentMemoryTerminalText.js";
import { AgentStateCardSchema } from "../StateCard/AgentStateCardTypes.js";
import { assessToolSearchEpisode } from "../ToolSearch/AgentToolSearchEpisodeScorer.js";
import { agentMemorySubject } from "../Continuity/AgentMemoryLearningLedger.js";
import { agentInteractionCounterpart } from "../Interaction/AgentInteractionIdentity.js";
import type { AgentIdentityDisplayValues } from "../Text/AgentTextParts.js";

const EpisodeSubjectSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["user", "agent", "unknown"]),
  legacyIds: z.array(z.string()).optional(),
  reference: z.string().min(1).optional(),
});
export function readAgentMemoryEpisodeSubject(episode: AgentMemoryEpisodeRecord) {
  const subject = EpisodeSubjectSchema.safeParse(episode.metadata.memorySubject);
  return subject.success ? subject.data : undefined;
}

/** Use the author recorded with the turn, rather than today's workspace profile. */
export function agentMemoryEpisodeDisplayValues(
  episode: AgentMemoryEpisodeRecord,
  identity: AgentIdentityDisplayValues | undefined,
): AgentIdentityDisplayValues | undefined {
  if (!identity) return undefined;
  if (typeof episode.metadata.memoryCounterpart === "string")
    return { ...identity, user: episode.metadata.memoryCounterpart };
  const subject = readAgentMemoryEpisodeSubject(episode);
  return subject && subject.id !== "owner" && !subject.legacyIds?.includes("owner")
    ? { ...identity, user: "" }
    : identity;
}

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
  const counterpart = agentInteractionCounterpart(input.interaction);
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
      memorySubject: {
        ...agentMemorySubject(input.interaction),
        ...(input.interaction?.actor ? { reference: input.interaction.actor.reference } : {}),
      },
      ...(counterpart === undefined ? {} : { memoryCounterpart: counterpart }),
      modelProvider: input.modelProvider,
      toolHistory: {
        tools: calls.map((call) => ({ name: call.toolName, status: call.status })),
        artifacts: [...new Set(calls.flatMap((call) => [...call.artifactUris, ...call.evidenceUris]))],
      },
      ...(stateCard ? { stateCard } : {}),
    },
  };
}
