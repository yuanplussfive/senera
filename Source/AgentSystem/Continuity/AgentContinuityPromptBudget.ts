import type { AgentContinuityPromptBudgetConfig } from "../Types/AgentToolAndMemoryConfigTypes.js";
import { renderAgentContinuityPromptWire } from "../Prompt/AgentPromptContextWireRenderer.js";
import {
  EmptyAgentContinuityMemoryPromptContext,
  type AgentContinuityEventCandidate,
  type AgentContinuityRecallSelection,
} from "./AgentContinuityMemoryTypes.js";

export interface AgentContinuityHistoricalTokenBudget {
  readonly maxTokens: number;
  readonly estimateTokens: (text: string) => number;
}

export function applyAgentContinuityPromptBudget(
  input: {
    readonly events: readonly AgentContinuityEventCandidate[];
    readonly pinnedEvents?: readonly AgentContinuityEventCandidate[];
    readonly historicalTokenBudget: AgentContinuityHistoricalTokenBudget;
    readonly diaryIndex?: string;
    readonly snapshotGeneration?: number;
    readonly measureTokens?: (events: readonly AgentContinuityEventCandidate[]) => number;
  },
  policy: AgentContinuityPromptBudgetConfig,
): {
  readonly events: readonly AgentContinuityEventCandidate[];
  readonly selection: AgentContinuityRecallSelection;
} {
  const maxTokens = Math.max(0, Math.floor(Math.min(policy.MaxTokens, input.historicalTokenBudget.maxTokens)));
  const options = { estimateTokens: input.historicalTokenBudget.estimateTokens };
  const measure =
    input.measureTokens ??
    ((events: readonly AgentContinuityEventCandidate[]) =>
      renderAgentContinuityPromptWire(
        {
          ...EmptyAgentContinuityMemoryPromptContext,
          enabled: true,
          eventCandidates: events,
          diaryIndex: input.diaryIndex,
          snapshotGeneration: input.snapshotGeneration,
        },
        options,
      ).tokenCount);
  // Importance determines priority. Cost decides whether a whole record fits;
  // dividing by length systematically discards detailed but critical findings.
  const candidates = [...input.events].sort(
    (left, right) =>
      right.score - left.score ||
      Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
      left.uri.localeCompare(right.uri),
  );
  const events: AgentContinuityEventCandidate[] = [];
  const selected = new Set<string>();
  const covered = new Set<string>();
  let usedTokens = measure([]);
  for (const entry of input.pinnedEvents ?? []) {
    const tokens = measure([...events, entry]);
    if (tokens > maxTokens || selected.has(entry.uri)) continue;
    events.push(entry);
    selected.add(entry.uri);
    for (const key of entry.dedupeKeys ?? []) covered.add(key);
    usedTokens = tokens;
  }
  for (const candidate of candidates) {
    if (selected.has(candidate.uri) || covered.has(candidate.uri + "@" + candidate.revision)) continue;
    const nextEvents = [...events, candidate];
    const tokens = measure(nextEvents);
    if (tokens > maxTokens) continue;
    selected.add(candidate.uri);
    for (const key of candidate.dedupeKeys ?? []) covered.add(key);
    usedTokens = tokens;
    events.push(candidate);
  }
  return {
    events,
    selection: {
      events: { available: input.events.length, matched: input.events.length, selected: events.length },
      usedTokens,
      maxTokens,
    },
  };
}
