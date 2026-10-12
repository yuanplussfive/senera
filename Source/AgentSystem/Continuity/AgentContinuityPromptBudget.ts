import type { AgentContinuityPromptBudgetConfig } from "../Types/AgentToolAndMemoryConfigTypes.js";
import { renderAgentContinuityPromptWire } from "../Prompt/AgentPromptContextWireRenderer.js";
import {
  EmptyAgentContinuityMemoryPromptContext,
  type AgentContinuityDigestPromptEntry,
  type AgentContinuityEventCandidate,
  type AgentContinuityRecallSelection,
} from "./AgentContinuityMemoryTypes.js";

export interface AgentContinuityHistoricalTokenBudget {
  readonly maxTokens: number;
  readonly estimateTokens: (text: string) => number;
}

export function applyAgentContinuityPromptBudget(
  input: {
    readonly digests: readonly AgentContinuityDigestPromptEntry[];
    readonly events: readonly AgentContinuityEventCandidate[];
    readonly historicalTokenBudget: AgentContinuityHistoricalTokenBudget;
  },
  policy: AgentContinuityPromptBudgetConfig,
): {
  readonly digests: readonly AgentContinuityDigestPromptEntry[];
  readonly events: readonly AgentContinuityEventCandidate[];
  readonly selection: AgentContinuityRecallSelection;
} {
  const maxTokens = Math.max(0, Math.floor(Math.min(policy.MaxTokens, input.historicalTokenBudget.maxTokens)));
  const options = { estimateTokens: input.historicalTokenBudget.estimateTokens };
  const measure = (
    digests: readonly AgentContinuityDigestPromptEntry[],
    events: readonly AgentContinuityEventCandidate[],
  ) =>
    renderAgentContinuityPromptWire(
      { ...EmptyAgentContinuityMemoryPromptContext, enabled: true, periodDigests: digests, eventCandidates: events },
      options,
    ).tokenCount;
  const candidates = [
    ...input.digests.map((entry) => ({
      kind: "digest" as const,
      entry,
      tokens: measure([entry], []),
    })),
    ...input.events.map((entry) => ({
      kind: "event" as const,
      entry,
      tokens: measure([], [entry]),
    })),
  ].sort(
    (left, right) =>
      right.entry.score / Math.max(1, right.tokens) - left.entry.score / Math.max(1, left.tokens) ||
      right.entry.score - left.entry.score ||
      left.entry.uri.localeCompare(right.entry.uri),
  );
  const digests: AgentContinuityDigestPromptEntry[] = [];
  const events: AgentContinuityEventCandidate[] = [];
  const selected = new Set<string>();
  const covered = new Set<string>();
  let usedTokens = 0;
  for (const candidate of candidates) {
    if (selected.has(candidate.entry.uri) || covered.has(candidate.entry.uri + "@" + candidate.entry.revision))
      continue;
    const nextDigests = candidate.kind === "digest" ? [...digests, candidate.entry] : digests;
    const nextEvents = candidate.kind === "event" ? [...events, candidate.entry] : events;
    const tokens = measure(nextDigests, nextEvents);
    if (tokens > maxTokens) continue;
    selected.add(candidate.entry.uri);
    for (const key of candidate.entry.deliveryKeys ?? []) covered.add(key);
    usedTokens = tokens;
    if (candidate.kind === "digest") digests.push(candidate.entry);
    else events.push(candidate.entry);
  }
  return {
    digests,
    events,
    selection: {
      digests: { available: input.digests.length, matched: input.digests.length, selected: digests.length },
      events: { available: input.events.length, matched: input.events.length, selected: events.length },
      usedTokens,
      maxTokens,
    },
  };
}
