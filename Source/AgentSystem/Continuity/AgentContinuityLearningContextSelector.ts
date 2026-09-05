import { stringifyAgentCanonicalJson } from "../Core/AgentCanonicalJson.js";
import type { AgentMemoryRecordedTurn, AgentMemorySourceRecord } from "../Memory/AgentMemorySourceRepository.js";
import type { AgentAgendaRecord } from "../Agenda/AgentAgendaTypes.js";
import type { AgentResidentProfilePromptEntry } from "../Profile/AgentResidentProfileTypes.js";
import type { ResolvedAgentContinuityRecallRankingConfig } from "../Types/AgentToolAndMemoryConfigTypes.js";
import type { AgentContinuityLearningReferent } from "./AgentContinuityLearningReferentContext.js";
import { AgentContinuityTextSimilarity } from "./AgentContinuityTextSimilarity.js";

export interface AgentContinuityLearningCatalogSelection {
  readonly profiles: readonly AgentResidentProfilePromptEntry[];
  readonly agendaRecords: readonly AgentAgendaRecord[];
}

/** Selects the most episode-relevant host catalogs under one shared character budget. */
export function selectAgentContinuityLearningCatalogs(input: {
  readonly recordedTurn: AgentMemoryRecordedTurn;
  readonly referents: readonly AgentContinuityLearningReferent[];
  readonly profiles: readonly AgentResidentProfilePromptEntry[];
  readonly agendaRecords: readonly AgentAgendaRecord[];
  readonly budgetCharacters: number;
  readonly similarity: ResolvedAgentContinuityRecallRankingConfig["Similarity"];
}): AgentContinuityLearningCatalogSelection {
  assertCatalogBudget(input.budgetCharacters);
  const similarity = new AgentContinuityTextSimilarity(input.similarity);
  const query = learningQuery(input.recordedTurn, input.referents);
  const candidates: CatalogCandidate[] = [
    ...input.profiles.map((entry, index) => ({
      kind: "profile" as const,
      index,
      cost: stringifyAgentCanonicalJson({ key: entry.key, value: entry.valueJson }).length,
      score: similarity.compare(query, entry.claim).score,
    })),
    ...input.agendaRecords.map((record, index) => ({
      kind: "agenda" as const,
      index,
      cost: stringifyAgentCanonicalJson({
        kind: record.kind,
        actor: record.actor.role,
        summary: record.summary,
        status: record.status,
        dueAt: record.dueAt,
        startsAt: record.startsAt,
        endsAt: record.endsAt,
      }).length,
      score: similarity.compare(query, [record.summary, record.detail].filter(Boolean).join(" ")).score,
    })),
  ].sort(compareCandidates);
  const selectedProfiles: AgentResidentProfilePromptEntry[] = [];
  const selectedAgenda: AgentAgendaRecord[] = [];
  let remaining = input.budgetCharacters;
  for (const candidate of candidates) {
    if (candidate.cost > remaining) continue;
    remaining -= candidate.cost;
    if (candidate.kind === "profile") selectedProfiles.push(input.profiles[candidate.index]!);
    else selectedAgenda.push(input.agendaRecords[candidate.index]!);
  }
  return { profiles: selectedProfiles, agendaRecords: selectedAgenda };
}

interface CatalogCandidate {
  readonly kind: "profile" | "agenda";
  readonly index: number;
  readonly cost: number;
  readonly score: number;
}

function learningQuery(
  recordedTurn: AgentMemoryRecordedTurn,
  referents: readonly AgentContinuityLearningReferent[],
): string {
  return [
    ...recordedTurn.sources.filter((source) => source.sourceKind !== "assistant_final").map(sourceSearchText),
    ...referents.map(({ text }) => text),
  ]
    .filter(Boolean)
    .join("\n");
}

function sourceSearchText(source: AgentMemorySourceRecord): string {
  return [source.textContent, source.summary, source.toolName].filter(Boolean).join(" ");
}

function compareCandidates(left: CatalogCandidate, right: CatalogCandidate): number {
  return (
    right.score - left.score ||
    left.cost - right.cost ||
    left.kind.localeCompare(right.kind) ||
    left.index - right.index
  );
}

function assertCatalogBudget(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Continuity learning catalog budget must be a positive safe integer.");
  }
}
