import type {
  AgentContinuityEpisodePromptInput,
  AgentContinuityFactPromptInput,
  AgentContinuityRulePromptInput,
} from "../ActionPlanner/AgentLearningPromptJson.js";
import type { AgentMemoryRecordedTurn, AgentMemorySourceRecord } from "../Memory/AgentMemorySourceRepository.js";
import type { AgentResidentProfilePromptEntry } from "../Profile/AgentResidentProfileTypes.js";
import { DefaultAgentTimeZone } from "../Time/AgentTime.js";
import type { AgentContinuityModelingContext } from "./AgentContinuityRuleContext.js";
import type { AgentContinuityLearningReferent } from "./AgentContinuityLearningReferentContext.js";
import type { AgentAgendaSnapshot } from "../Agenda/AgentAgendaTypes.js";
import { readAgentMemorySourceText } from "../Memory/AgentMemorySourceText.js";

/** Projects each physical source exactly once; no timeline/source-catalog duplication. */
export function buildAgentContinuityFactPromptInput(
  recordedTurn: AgentMemoryRecordedTurn,
  residentProfile: readonly AgentResidentProfilePromptEntry[],
  referents: readonly AgentContinuityLearningReferent[],
  agenda: AgentAgendaSnapshot,
): AgentContinuityFactPromptInput {
  return {
    ...projectEpisode(recordedTurn, referents),
    profileCatalog: projectProfileCatalog(residentProfile),
    agentProfileCatalog: projectProfileCatalog(residentProfile, "agent"),
    agendaCatalog: agenda.records.map((record) => ({
      kind: record.kind,
      actor: record.actor.role,
      summary: record.summary,
      status: record.status,
      ...(record.dueAt ? { dueAt: record.dueAt } : {}),
      ...(record.startsAt ? { startsAt: record.startsAt } : {}),
      ...(record.endsAt ? { endsAt: record.endsAt } : {}),
    })),
  };
}

export function buildAgentContinuityRulePromptInput(
  recordedTurn: AgentMemoryRecordedTurn,
  facts: readonly string[],
  modelingContext: Pick<AgentContinuityModelingContext, "stateCatalog" | "ruleCatalog">,
  referents: readonly AgentContinuityLearningReferent[],
): AgentContinuityRulePromptInput {
  return {
    ...projectEpisode(recordedTurn, referents),
    facts: [...facts],
    stateCatalog: modelingContext.stateCatalog,
    ruleCatalog: modelingContext.ruleCatalog,
  };
}

function projectEpisode(
  recordedTurn: AgentMemoryRecordedTurn,
  referents: readonly AgentContinuityLearningReferent[],
): AgentContinuityEpisodePromptInput {
  const sources = recordedTurn.sources
    .slice()
    .sort((left, right) => left.createdAtMs - right.createdAtMs || left.uri.localeCompare(right.uri));
  return {
    timeZone: recordedTurn.episode.timeZone || DefaultAgentTimeZone,
    completedAt: recordedTurn.episode.completedAt,
    evidence: sources.filter((source) => source.sourceKind !== "assistant_final").map(projectEvidence),
    turnContext: sources.filter((source) => source.sourceKind === "assistant_final").map(projectAssistantContext),
    referents: referents.map((referent) => ({ ...referent })),
  };
}

function projectEvidence(source: AgentMemorySourceRecord): AgentContinuityEpisodePromptInput["evidence"][number] {
  const facts = projectEvidenceFacts(source.metadata.evidence);
  return {
    kind: source.sourceKind === "user_message" ? "user" : "tool",
    text: sourceText(source),
    ...(source.toolName ? { toolName: source.toolName } : {}),
    ...(facts.length > 0 ? { facts } : {}),
    createdAt: source.createdAt,
  };
}

function projectAssistantContext(
  source: AgentMemorySourceRecord,
): AgentContinuityEpisodePromptInput["turnContext"][number] {
  return {
    kind: "assistant_final",
    text: sourceText(source),
    createdAt: source.createdAt,
  };
}

function sourceText(source: AgentMemorySourceRecord): string {
  return readAgentMemorySourceText(source, source.sourceKind === "user_message" ? "content_first" : "summary_first");
}

function projectEvidenceFacts(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const facts = (value as { facts?: unknown }).facts;
  if (!Array.isArray(facts)) return [];
  return facts.flatMap((fact) => {
    if (!fact || typeof fact !== "object" || Array.isArray(fact)) return [];
    const name = (fact as { name?: unknown }).name;
    const value = (fact as { value?: unknown }).value;
    return typeof name === "string" && typeof value === "string" ? [`${name}: ${value}`] : [];
  });
}

function projectProfileCatalog(
  entries: readonly AgentResidentProfilePromptEntry[],
  subject: AgentResidentProfilePromptEntry["subject"] = "user",
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    entries
      .filter((entry) => entry.subject === subject)
      .map((entry) => {
        const value: unknown = JSON.parse(entry.valueJson);
        if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
          throw new Error(`Resident profile ${entry.key} is not scalar.`);
        }
        return [entry.key, value];
      }),
  );
}
