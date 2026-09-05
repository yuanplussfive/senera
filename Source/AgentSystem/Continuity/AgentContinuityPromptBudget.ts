import type { AgentContinuityPromptBudgetConfig } from "../Types/AgentToolAndMemoryConfigTypes.js";
import type {
  AgentContinuityEvidenceCandidate,
  AgentContinuityEventCandidate,
  AgentContinuityFactCatalogEntry,
  AgentContinuityRecallSelection,
} from "./AgentContinuityMemoryTypes.js";
import type { AgentContinuityStyleExample } from "./AgentContinuityStyleExamples.js";
import type { AgentContinuityGraphPromptRelation } from "./AgentContinuityGraphTypes.js";
import type { AgentResidentProfilePromptEntry } from "../Profile/AgentResidentProfileTypes.js";

export interface AgentContinuityPromptBudgetInput {
  readonly profiles: readonly AgentResidentProfilePromptEntry[];
  readonly facts: readonly AgentContinuityFactCatalogEntry[];
  readonly relations: readonly AgentContinuityGraphPromptRelation[];
  readonly events: readonly AgentContinuityEventCandidate[];
  readonly evidence: readonly AgentContinuityEvidenceCandidate[];
  readonly styleExamples?: readonly AgentContinuityStyleExample[];
  readonly availableFactCount: number;
  readonly availableRelationCount: number;
  readonly availableEventCount: number;
}

export interface AgentContinuityPromptBudgetResult {
  readonly profiles: readonly AgentResidentProfilePromptEntry[];
  readonly facts: readonly AgentContinuityFactCatalogEntry[];
  readonly relations: readonly AgentContinuityGraphPromptRelation[];
  readonly events: readonly AgentContinuityEventCandidate[];
  readonly evidence: readonly AgentContinuityEvidenceCandidate[];
  readonly styleExamples?: readonly AgentContinuityStyleExample[];
  readonly selection: AgentContinuityRecallSelection;
}

/** Applies one shared, observable budget in semantic priority order. */
export function applyAgentContinuityPromptBudget(
  input: AgentContinuityPromptBudgetInput,
  policy: AgentContinuityPromptBudgetConfig,
): AgentContinuityPromptBudgetResult {
  const state = { remaining: policy.MaxCharacters, used: 0 };
  const profiles = takeWithinBudget(input.profiles, policy.MaxProfileEntries, profileCharacters, state);
  const facts = takeWithinBudget(input.facts, policy.MaxFactEntries, factCharacters, state);
  const relations = takeWithinBudget(input.relations, policy.MaxRelationEntries, relationCharacters, state);
  const styleExamples = takeWithinBudget(
    input.styleExamples ?? [],
    policy.MaxEventEntries,
    styleExampleCharacters,
    state,
  );
  const events = takeWithinBudget(
    input.events,
    Math.max(0, policy.MaxEventEntries - styleExamples.length),
    eventCharacters,
    state,
  );
  const evidence = takeWithinBudget(input.evidence, policy.MaxEvidenceEntries, evidenceCharacters, state);

  return {
    profiles,
    facts,
    relations,
    events,
    evidence,
    styleExamples,
    selection: {
      profiles: counts(input.profiles.length, input.profiles.length, profiles.length),
      facts: counts(input.availableFactCount, input.facts.length, facts.length),
      relations: counts(input.availableRelationCount, input.relations.length, relations.length),
      events: counts(input.availableEventCount, input.events.length, events.length),
      evidence: counts(input.evidence.length, input.evidence.length, evidence.length),
      styleExamples: counts(input.styleExamples?.length ?? 0, input.styleExamples?.length ?? 0, styleExamples.length),
      usedCharacters: state.used,
      maxCharacters: policy.MaxCharacters,
    },
  };
}

function takeWithinBudget<T>(
  entries: readonly T[],
  maxEntries: number,
  measure: (entry: T) => number,
  state: { remaining: number; used: number },
): T[] {
  const selected: T[] = [];
  for (const entry of entries) {
    if (selected.length >= maxEntries) break;
    const characters = Math.max(1, measure(entry));
    if (characters > state.remaining) continue;
    selected.push(entry);
    state.remaining -= characters;
    state.used += characters;
  }
  return selected;
}

function profileCharacters(entry: AgentResidentProfilePromptEntry): number {
  return entry.key.length + entry.claim.length + entry.validUntil.length;
}

function factCharacters(entry: AgentContinuityFactCatalogEntry): number {
  return entry.claim.length + (entry.validUntil?.length ?? 0);
}

function relationCharacters(entry: AgentContinuityGraphPromptRelation): number {
  return (
    entry.subject.length +
    entry.relation.length +
    entry.object.length +
    (entry.temporal.startsAt?.length ?? 0) +
    (entry.temporal.endsAt?.length ?? 0)
  );
}

function eventCharacters(entry: AgentContinuityEventCandidate): number {
  return entry.summary.length + entry.occurredAt.length + sourceCharacters(entry.sourceRefs);
}

function styleExampleCharacters(entry: AgentContinuityStyleExample): number {
  return entry.userText.length + entry.assistantText.length + sourceCharacters(entry.sourceRefs);
}

function evidenceCharacters(entry: AgentContinuityEvidenceCandidate): number {
  return sourceCharacters(entry.sourceRefs);
}

function sourceCharacters(sourceRefs: readonly string[]): number {
  return sourceRefs.reduce((total, value) => total + value.length, 0);
}

function counts(available: number, matched: number, selected: number) {
  return { available, matched, selected };
}
