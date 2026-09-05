import fuzzysort from "fuzzysort";
import type { AgentPresetLoreEntry } from "./AgentPresetTypes.js";

export function selectAgentPresetLore(
  entries: readonly AgentPresetLoreEntry[],
  userInput: string,
): AgentPresetLoreEntry[] {
  const query = userInput.trim().normalize("NFC");
  if (!query) return [];
  const normalizedQuery = query.toLocaleLowerCase();

  return entries
    .filter((entry) => entry.enabled)
    .map((entry) => ({ entry, score: loreScore(entry, normalizedQuery) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.entry.title.localeCompare(right.entry.title))
    .map((candidate) => candidate.entry);
}

function loreScore(entry: AgentPresetLoreEntry, query: string): number {
  const normalizedKeywords = entry.keywords.map((keyword) => keyword.trim().normalize("NFC").toLocaleLowerCase());
  const exactKeywordScore = normalizedKeywords.reduce(
    (score, keyword) => score + (keyword.length > 0 && query.includes(keyword) ? 10 + keyword.length : 0),
    0,
  );
  const fuzzyScore = bestFuzzyKeywordScore(queryTerms(query), [entry.title, ...normalizedKeywords]);
  const normalizedFuzzyScore = fuzzyScore * 4;
  return exactKeywordScore + normalizedFuzzyScore;
}

function queryTerms(query: string): string[] {
  return query.match(/[\p{Script=Han}]{2,}|[\p{L}\p{N}][\p{L}\p{N}._-]*/gu) ?? [];
}

function bestFuzzyKeywordScore(queryTerms: readonly string[], targets: readonly string[]): number {
  return queryTerms.reduce((best, term) => {
    if (term.length < 3) return best;
    return targets.reduce((bestTarget, target) => {
      const score = fuzzysort.single(term, target)?.score ?? 0;
      return Math.max(bestTarget, score);
    }, best);
  }, 0);
}
