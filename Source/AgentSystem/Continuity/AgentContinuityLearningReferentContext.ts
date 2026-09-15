import type {
  AgentMemoryEpisodeRecord,
  AgentMemoryRecordedTurn,
  AgentMemorySourceRecord,
  AgentMemorySourceRepository,
} from "../Memory/AgentMemorySourceRepository.js";
import { readAgentMemorySourceText } from "../Memory/AgentMemorySourceText.js";

export interface AgentContinuityLearningReferent {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt: string;
}

export interface AgentContinuityLearningReferentContext {
  readonly entries: readonly AgentContinuityLearningReferent[];
}

/**
 * Supplies the closest completed conversation turns as reference-only context.
 * It deliberately reads physical history instead of the live Pi transcript so
 * deferred jobs and restarted runtimes see the same immutable inputs.
 */
export function buildAgentContinuityLearningReferentContext(input: {
  readonly sourceRepository: Pick<AgentMemorySourceRepository, "listEpisodes" | "listSources">;
  readonly recordedTurn: AgentMemoryRecordedTurn;
  readonly budgetCharacters: number;
}): AgentContinuityLearningReferentContext {
  validateBudget(input.budgetCharacters);
  const current = input.recordedTurn.episode;
  const priorEpisodes = input.sourceRepository
    .listEpisodes(current.sessionId)
    .filter((episode) => isPriorEpisode(episode, current))
    .sort((left, right) => right.completedAtMs - left.completedAtMs || right.id.localeCompare(left.id));

  let remaining = input.budgetCharacters;
  const selected: AgentContinuityLearningReferent[] = [];
  for (const episode of priorEpisodes) {
    const turn = projectEpisodeReferents(input.sourceRepository.listSources(episode.uri));
    const footprint = turn.reduce((total, entry) => total + entry.text.length, 0);
    if (turn.length === 0) continue;
    if (footprint > remaining) break;
    selected.unshift(...turn);
    remaining -= footprint;
  }

  return { entries: selected };
}

function isPriorEpisode(candidate: AgentMemoryEpisodeRecord, current: AgentMemoryEpisodeRecord): boolean {
  return candidate.uri !== current.uri && candidate.completedAtMs <= current.startedAtMs;
}

function projectEpisodeReferents(sources: readonly AgentMemorySourceRecord[]): AgentContinuityLearningReferent[] {
  return sources
    .filter((source) => source.sourceKind === "user_message" || source.sourceKind === "assistant_final")
    .sort((left, right) => left.createdAtMs - right.createdAtMs || left.uri.localeCompare(right.uri))
    .flatMap((source) => {
      const text = sourceText(source);
      if (!text) return [];
      return [
        {
          role: source.sourceKind === "user_message" ? ("user" as const) : ("assistant" as const),
          text,
          createdAt: source.createdAt,
        },
      ];
    });
}

function sourceText(source: AgentMemorySourceRecord): string {
  return readAgentMemorySourceText(source, source.sourceKind === "assistant_final" ? "summary_first" : "content_first");
}

function validateBudget(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Continuity referent context budget must be a positive safe integer.");
  }
}
