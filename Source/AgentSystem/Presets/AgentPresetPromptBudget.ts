import type { ResolvedAgentPresetPromptBudgetConfig } from "../Types/AgentConfigTypes.js";
import type { AgentPresetPromptExample, AgentPresetPromptLoreEntry } from "./AgentPresetTypes.js";

export const AgentPresetPromptBudgetDefaults = {
  MaxExamples: 4,
  MaxLoreEntries: 6,
  MaxSupplementalCharacters: 12_000,
} satisfies ResolvedAgentPresetPromptBudgetConfig;

export interface AgentPresetPromptBudgetInput {
  readonly examples: readonly AgentPresetPromptExample[];
  readonly lore: readonly AgentPresetPromptLoreEntry[];
}

/** Keeps authored voice examples stable while bounding per-turn supplemental persona context. */
export function applyAgentPresetPromptBudget(
  input: AgentPresetPromptBudgetInput,
  policy: ResolvedAgentPresetPromptBudgetConfig,
): AgentPresetPromptBudgetInput {
  const state = { remaining: policy.MaxSupplementalCharacters };
  const examples = takeEntries(input.examples, policy.MaxExamples, exampleCharacters, state);
  const lore = takeEntries(input.lore, policy.MaxLoreEntries, loreCharacters, state);
  return { examples, lore };
}

function takeEntries<T>(
  entries: readonly T[],
  maxEntries: number,
  measure: (entry: T) => number,
  state: { remaining: number },
): T[] {
  const selected: T[] = [];
  for (const entry of entries) {
    if (selected.length >= maxEntries) break;
    const characters = measure(entry);
    if (characters > state.remaining) continue;
    selected.push(entry);
    state.remaining -= characters;
  }
  return selected;
}

function exampleCharacters(entry: AgentPresetPromptExample): number {
  return entry.situation.length + entry.reply.length;
}

function loreCharacters(entry: AgentPresetPromptLoreEntry): number {
  return entry.title.length + entry.content.length;
}
