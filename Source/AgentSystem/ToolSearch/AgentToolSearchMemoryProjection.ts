import crypto from "node:crypto";
import { type AgentToolSearchTokenizer } from "./AgentToolSearchTokenizer.js";
import type {
  AgentToolLearningProjection,
  AgentToolLearningTermAggregate,
  AgentToolSearchEpisode,
  AgentToolSearchEpisodeCall,
  AgentToolSearchLearnedKeyword,
  AgentToolUsePatternAggregate,
  AgentToolUsePatternMatch,
} from "./AgentToolSearchMemoryTypes.js";

export const AgentToolSearchMemorySuccessEvidence = 1;
export const AgentToolSearchMemoryBetaPrior = 1;

export function learnedKeywordWeights(
  keywords: readonly AgentToolSearchLearnedKeyword[],
  tokenizer: AgentToolSearchTokenizer,
): Map<string, number> {
  const weights = new Map<string, number>();
  for (const keyword of keywords) {
    addWeightedTerm(weights, keyword.value, keyword.weight, tokenizer);
  }
  return weights;
}

export function singleTermWeights(
  term: string,
  weight: number,
  tokenizer: AgentToolSearchTokenizer,
): Map<string, number> {
  const weights = new Map<string, number>();
  addWeightedTerm(weights, term, weight, tokenizer);
  return weights;
}

export function weightedSimilarity(queryTokens: Set<string>, episodeWeights: Map<string, number>): number {
  if (queryTokens.size === 0 || episodeWeights.size === 0) {
    return 0;
  }

  let matchedWeight = 0;
  for (const [token, weight] of episodeWeights) {
    if (queryTokens.has(token)) {
      matchedWeight += weight;
    }
  }

  return 1 - Math.exp(-matchedWeight);
}

export function projectLearningProjection(
  episode: AgentToolSearchEpisode,
  tokenizer: AgentToolSearchTokenizer,
): AgentToolLearningProjection {
  return {
    terms: projectTermAggregates(episode),
    patterns: projectPatternAggregates(episode, tokenizer),
  };
}

export function patternFromAggregate(
  pattern: AgentToolUsePatternAggregate,
  similarity: number,
  tokenizer: AgentToolSearchTokenizer,
): AgentToolUsePatternMatch {
  const confidence = confidenceFromSupport(pattern.support);
  const supportCount = pattern.support;
  const score = similarity * confidence * Math.log1p(supportCount);
  const terms = topWeightedKeys(learnedKeywordWeights(pattern.triggerTerms, tokenizer));

  return {
    toolName: pattern.toolName,
    triggerSummary: terms.length > 0 ? `相关触发词：${terms.join("、")}` : "历史成功样本显示当前请求与该工具相关。",
    argumentGuidance:
      pattern.argumentKeys.length > 0
        ? `按当前用户目标填写这些历史有效参数：${pattern.argumentKeys.join("、")}。`
        : "按工具签名和当前用户目标构造参数。",
    evidenceGoal:
      pattern.evidenceKinds.length > 0
        ? `历史成功结果通常产生：${pattern.evidenceKinds.join("、")}。`
        : "以工具结果能支持当前回答为准。",
    confidence,
    supportCount,
    successCount: pattern.support,
    failureCount: 0,
    lastSeenAt: pattern.lastSeenAt,
    score,
  };
}

export function confidenceFromSupport(support: number): number {
  return (support + AgentToolSearchMemoryBetaPrior) / (support + AgentToolSearchMemoryBetaPrior * 2);
}

export function mergeTermAggregate(
  current: AgentToolLearningTermAggregate | undefined,
  next: AgentToolLearningTermAggregate,
): AgentToolLearningTermAggregate {
  if (!current) {
    return next;
  }
  return {
    ...current,
    support: current.support + next.support,
    weight: Math.max(current.weight, next.weight),
    lastSeenAt: Math.max(current.lastSeenAt, next.lastSeenAt),
  };
}

export function mergePatternAggregate(
  current: AgentToolUsePatternAggregate | undefined,
  next: AgentToolUsePatternAggregate,
): AgentToolUsePatternAggregate {
  if (!current) {
    return next;
  }
  return {
    ...current,
    triggerTerms: mergeLearnedKeywords(current.triggerTerms, next.triggerTerms),
    argumentKeys: uniqueSorted([...current.argumentKeys, ...next.argumentKeys]),
    evidenceKinds: uniqueSorted([...current.evidenceKinds, ...next.evidenceKinds]),
    support: current.support + next.support,
    lastSeenAt: Math.max(current.lastSeenAt, next.lastSeenAt),
  };
}

export function termAggregateKey(term: AgentToolLearningTermAggregate): string {
  return [term.projectId, term.toolName, term.source, term.term].join("\u0000");
}

export function patternAggregateKey(pattern: AgentToolUsePatternAggregate): string {
  return [pattern.projectId, pattern.toolName, pattern.patternKey].join("\u0000");
}

export function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function addWeightedTerm(
  weights: Map<string, number>,
  value: string,
  weight: number,
  tokenizer: AgentToolSearchTokenizer,
): void {
  const normalizedWeight = Number.isFinite(weight) && weight > 0 ? weight : 0;
  if (normalizedWeight <= 0) {
    return;
  }

  const tokens = tokenizer.tokenize(value);
  if (tokens.length === 0) {
    return;
  }

  const tokenWeight = normalizedWeight / tokens.length;
  for (const token of tokens) {
    weights.set(token, Math.max(weights.get(token) ?? 0, tokenWeight));
  }
}

function projectTermAggregates(episode: AgentToolSearchEpisode): AgentToolLearningTermAggregate[] {
  if (!isSuccessfulEpisode(episode)) {
    return [];
  }

  const aggregates = new Map<string, AgentToolLearningTermAggregate>();
  for (const keyword of episode.learnedKeywords) {
    if (!episode.chosenTools.includes(keyword.toolName)) {
      continue;
    }
    const next = {
      projectId: episode.projectId,
      toolName: keyword.toolName,
      term: keyword.value,
      source: keyword.source,
      support: keyword.weight * AgentToolSearchMemorySuccessEvidence,
      weight: keyword.weight,
      lastSeenAt: episode.timestamp,
    };
    const key = termAggregateKey(next);
    aggregates.set(key, mergeTermAggregate(aggregates.get(key), next));
  }
  return [...aggregates.values()];
}

function projectPatternAggregates(
  episode: AgentToolSearchEpisode,
  tokenizer: AgentToolSearchTokenizer,
): AgentToolUsePatternAggregate[] {
  return episode.calls.flatMap((call) => {
    if (!isSuccessfulCall(call)) {
      return [];
    }
    const triggerTerms = episode.learnedKeywords
      .filter((keyword) => keyword.toolName === call.toolName)
      .filter((keyword) => learnedKeywordWeights([keyword], tokenizer).size > 0);
    if (triggerTerms.length === 0) {
      return [];
    }
    return [
      {
        projectId: episode.projectId,
        toolName: call.toolName,
        patternKey: patternKey(call),
        triggerTerms,
        argumentKeys: uniqueSorted(call.argumentKeys),
        evidenceKinds: uniqueSorted(call.evidenceKinds),
        support: AgentToolSearchMemorySuccessEvidence,
        lastSeenAt: episode.timestamp,
      },
    ];
  });
}

function isSuccessfulEpisode(episode: AgentToolSearchEpisode): boolean {
  return (
    episode.outcome === "success" &&
    episode.finalScore > 0 &&
    episode.finalOutcome.toolExecutionSucceeded &&
    (episode.finalOutcome.producedEvidence ||
      episode.finalOutcome.producedArtifact ||
      episode.finalOutcome.changedWorkspace)
  );
}

function isSuccessfulCall(call: AgentToolSearchEpisodeCall): boolean {
  return (
    call.status === "success" && call.score > 0 && (call.hasEvidence || call.hasArtifact || call.hasWorkspaceChanges)
  );
}

function topWeightedKeys(values: Map<string, number>): string[] {
  return [...values.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 6)
    .map(([key]) => key);
}

function mergeLearnedKeywords(
  current: readonly AgentToolSearchLearnedKeyword[],
  next: readonly AgentToolSearchLearnedKeyword[],
): AgentToolSearchLearnedKeyword[] {
  const byKey = new Map<string, AgentToolSearchLearnedKeyword>();
  for (const keyword of [...current, ...next]) {
    const key = [keyword.toolName, keyword.source, keyword.value].join("\u0000");
    const previous = byKey.get(key);
    byKey.set(key, previous && previous.weight >= keyword.weight ? previous : keyword);
  }
  return [...byKey.values()].sort(
    (left, right) =>
      left.toolName.localeCompare(right.toolName) ||
      left.source.localeCompare(right.source) ||
      left.value.localeCompare(right.value),
  );
}

function patternKey(call: AgentToolSearchEpisodeCall): string {
  return crypto
    .createHash("sha1")
    .update(
      JSON.stringify({
        arguments: call.argumentKeys,
        evidence: call.evidenceKinds,
      }),
    )
    .digest("hex");
}
