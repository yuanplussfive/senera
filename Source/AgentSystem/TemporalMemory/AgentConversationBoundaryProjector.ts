import { Temporal } from "@js-temporal/polyfill";
import type {
  AgentMemoryEpisodeRecord,
  AgentMemoryRecordedTurn,
  AgentMemorySourceRecord,
  AgentMemorySourceRepository,
} from "../Memory/AgentMemorySourceRepository.js";
import type { AgentTemporalMemorySqliteStore } from "./AgentTemporalMemorySqliteStore.js";
import type {
  AgentConversationBoundaryPromptInput,
  AgentConversationBoundaryTurn,
  AgentTemporalMemoryDigest,
} from "./AgentTemporalMemoryTypes.js";

export function projectAgentConversationBoundaryInput(input: {
  readonly segment: AgentTemporalMemoryDigest;
  readonly candidate: AgentMemoryRecordedTurn;
  readonly store: AgentTemporalMemorySqliteStore;
  readonly sources: AgentMemorySourceRepository;
  readonly timeZone: string;
  readonly anchors: readonly string[];
}): AgentConversationBoundaryPromptInput {
  const memberUris = input.store.members(input.segment.id).map((member) => member.memberUri);
  const episodes = input.sources.findEpisodesByUris(memberUris);
  const sources = input.sources.listSourcesForEpisodes(memberUris);
  const sourcesByEpisode = groupSources(sources);
  const turns = episodes
    .slice()
    .sort((left, right) => left.completedAtMs - right.completedAtMs || left.id.localeCompare(right.id))
    .map((episode) => projectTurn(episode, sourcesByEpisode.get(episode.uri) ?? []));
  const classificationTurns = input.segment.workingFocus ? turns.slice(-1) : turns;
  return {
    timeZone: input.timeZone,
    elapsedSeconds: Math.max(0, (input.candidate.episode.startedAtMs - input.segment.periodEndMs) / 1_000),
    sameLocalDate:
      localDate(input.segment.periodEnd, input.timeZone) ===
      localDate(input.candidate.episode.completedAt, input.timeZone),
    anchors: normalizeTextList(input.anchors),
    openSegment: {
      digestUri: input.segment.uri,
      periodStart: input.segment.periodStart,
      periodEnd: input.segment.periodEnd,
      focus: input.segment.workingFocus || null,
      turns: classificationTurns,
    },
    candidate: projectTurn(input.candidate.episode, input.candidate.sources),
  };
}

function projectTurn(
  episode: AgentMemoryEpisodeRecord,
  sources: readonly AgentMemorySourceRecord[],
): AgentConversationBoundaryTurn {
  const user = sources.find((source) => source.sourceKind === "user_message");
  const assistant = sources.find((source) => source.sourceKind === "assistant_final");
  if (!user?.textContent?.trim() || !assistant?.textContent?.trim()) {
    throw new Error(`Conversation boundary turn lacks physical user or assistant text: ${episode.uri}`);
  }
  return {
    episodeUri: episode.uri,
    startedAt: episode.startedAt,
    completedAt: episode.completedAt,
    user: user.textContent.trim(),
    assistant: assistant.textContent.trim(),
    tools: sources
      .filter((source) => source.sourceKind === "tool_evidence")
      .map((source) => ({
        name: source.toolName,
        summary: source.summary?.trim() ?? "",
        content: source.textContent?.trim() ?? "",
      })),
  };
}

function groupSources(sources: readonly AgentMemorySourceRecord[]): ReadonlyMap<string, AgentMemorySourceRecord[]> {
  const grouped = new Map<string, AgentMemorySourceRecord[]>();
  for (const source of sources) {
    grouped.set(source.episodeUri, [...(grouped.get(source.episodeUri) ?? []), source]);
  }
  return grouped;
}

function localDate(instant: string, timeZone: string): string {
  return Temporal.Instant.from(instant).toZonedDateTimeISO(timeZone).toPlainDate().toString();
}

function normalizeTextList(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
