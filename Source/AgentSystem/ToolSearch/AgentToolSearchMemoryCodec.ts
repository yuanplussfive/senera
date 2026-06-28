import { z } from "zod";
import type {
  AgentToolLearningTermAggregate,
  AgentToolSearchEpisode,
  AgentToolUsePatternAggregate,
} from "./AgentToolSearchMemoryTypes.js";
import type {
  StoredEpisodeRow,
  StoredPatternAggregateRow,
  StoredTermAggregateRow,
} from "./AgentToolSearchMemoryRows.js";

const StringArrayColumnSchema = z.array(z.string());
const LearnedKeywordColumnSchema = z.array(z.object({
  toolName: z.string().min(1),
  value: z.string().min(1),
  source: z.string().min(1),
  weight: z.number(),
}).strict());
const ToolCallColumnSchema = z.array(z.object({
  toolName: z.string().min(1),
  argumentKeys: z.array(z.string()),
  evidenceKinds: z.array(z.string()).default([]),
  status: z.enum(["success", "failure", "empty"]),
  evidenceUris: z.array(z.string()),
  artifactUris: z.array(z.string()),
  hasArtifact: z.boolean(),
  hasEvidence: z.boolean(),
  hasWorkspaceChanges: z.boolean(),
  errorCode: z.string().default(""),
  error: z.string(),
  score: z.number(),
}).strict());
const FinalOutcomeColumnSchema = z.object({
  toolExecutionSucceeded: z.boolean(),
  producedEvidence: z.boolean(),
  producedArtifact: z.boolean(),
  changedWorkspace: z.boolean(),
}).strict();

export function episodeRecord(episode: AgentToolSearchEpisode): Record<string, unknown> {
  return {
    query: episode.query,
    query_tokens: stringifyJsonColumn(StringArrayColumnSchema, episode.queryTokens),
    planner_tags: stringifyJsonColumn(StringArrayColumnSchema, episode.plannerTags),
    candidates: stringifyJsonColumn(StringArrayColumnSchema, episode.candidates),
    chosen_tools: stringifyJsonColumn(StringArrayColumnSchema, episode.chosenTools),
    learned_keywords: stringifyJsonColumn(LearnedKeywordColumnSchema, episode.learnedKeywords),
    outcome: episode.outcome,
    calls: stringifyJsonColumn(ToolCallColumnSchema, episode.calls),
    final_score: episode.finalScore,
    final_outcome: stringifyJsonColumn(FinalOutcomeColumnSchema, episode.finalOutcome),
    project_id: episode.projectId,
    timestamp: episode.timestamp,
  };
}

export function termAggregateRecord(term: AgentToolLearningTermAggregate): Record<string, unknown> {
  return {
    project_id: term.projectId,
    tool_name: term.toolName,
    term: term.term,
    source: term.source,
    support: term.support,
    weight: term.weight,
    last_seen_at: term.lastSeenAt,
  };
}

export function patternAggregateRecord(pattern: AgentToolUsePatternAggregate): Record<string, unknown> {
  return {
    project_id: pattern.projectId,
    tool_name: pattern.toolName,
    pattern_key: pattern.patternKey,
    trigger_terms: stringifyJsonColumn(LearnedKeywordColumnSchema, pattern.triggerTerms),
    argument_keys: stringifyJsonColumn(StringArrayColumnSchema, pattern.argumentKeys),
    evidence_kinds: stringifyJsonColumn(StringArrayColumnSchema, pattern.evidenceKinds),
    support: pattern.support,
    last_seen_at: pattern.lastSeenAt,
  };
}

export function rowToEpisode(row: StoredEpisodeRow): AgentToolSearchEpisode {
  return {
    query: row.query,
    queryTokens: parseJsonColumn(StringArrayColumnSchema, row.query_tokens),
    plannerTags: parseJsonColumn(StringArrayColumnSchema, row.planner_tags),
    candidates: parseJsonColumn(StringArrayColumnSchema, row.candidates),
    chosenTools: parseJsonColumn(StringArrayColumnSchema, row.chosen_tools),
    learnedKeywords: parseJsonColumn(LearnedKeywordColumnSchema, row.learned_keywords),
    outcome: row.outcome,
    calls: parseJsonColumn(ToolCallColumnSchema, row.calls),
    finalScore: row.final_score,
    finalOutcome: parseJsonColumn(FinalOutcomeColumnSchema, row.final_outcome),
    projectId: row.project_id,
    timestamp: row.timestamp,
  };
}

export function rowToTermAggregate(row: StoredTermAggregateRow): AgentToolLearningTermAggregate {
  return {
    projectId: row.project_id,
    toolName: row.tool_name,
    term: row.term,
    source: row.source,
    support: row.support,
    weight: row.weight,
    lastSeenAt: row.last_seen_at,
  };
}

export function rowToPatternAggregate(row: StoredPatternAggregateRow): AgentToolUsePatternAggregate {
  return {
    projectId: row.project_id,
    toolName: row.tool_name,
    patternKey: row.pattern_key,
    triggerTerms: parseJsonColumn(LearnedKeywordColumnSchema, row.trigger_terms),
    argumentKeys: parseJsonColumn(StringArrayColumnSchema, row.argument_keys),
    evidenceKinds: parseJsonColumn(StringArrayColumnSchema, row.evidence_kinds),
    support: row.support,
    lastSeenAt: row.last_seen_at,
  };
}

function stringifyJsonColumn<T>(schema: z.ZodType<T>, value: T): string {
  return JSON.stringify(schema.parse(value));
}

function parseJsonColumn<T>(schema: z.ZodType<T>, value: string): T {
  return schema.parse(JSON.parse(value) as unknown);
}

