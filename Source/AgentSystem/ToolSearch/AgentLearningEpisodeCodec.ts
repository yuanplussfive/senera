import { z } from "zod";
import { parseJsonText } from "../Core/AgentJsonParsing.js";
import {
  AgentLearningDomains,
  AgentLearningStates,
  type AgentLearningEpisode,
  type AgentLearningEpisodeResolution,
  type AgentSkillLearningTermAggregate,
} from "./AgentLearningEpisodeTypes.js";
import type { StoredLearningEpisodeRow, StoredSkillLearningTermRow } from "./AgentLearningEpisodeRows.js";
import { FinalOutcomeColumnSchema, ToolCallColumnSchema } from "./AgentToolSearchMemoryCodec.js";

const LearningSubjectSchema = z
  .object({
    kind: z.enum(["tool", "skill"]),
    name: z.string().min(1),
    revision: z.string().min(1).optional(),
  })
  .strict();

const LearningContextSchema = z
  .object({
    rawUserTurn: z.string(),
    standaloneRequest: z.string(),
    contextMode: z.string(),
    contextBasis: z.string(),
    candidates: z.array(z.string()),
    chosenTools: z.array(z.string()),
    activeSkills: z.array(
      z
        .object({
          name: z.string().min(1),
          revision: z.string().min(1),
          matchedTerms: z.array(z.string()),
        })
        .strict(),
    ),
  })
  .strict();

const LearningOutcomeSchema = z
  .object({
    outcome: z.enum(["success", "failure", "unknown"]),
    score: z.number(),
    calls: ToolCallColumnSchema,
    final: FinalOutcomeColumnSchema,
  })
  .strict();

export function learningEpisodeRecord(episode: AgentLearningEpisode): Record<string, unknown> {
  return {
    id: episode.id,
    domain: z.enum(AgentLearningDomains).parse(episode.domain),
    state: z.enum(AgentLearningStates).parse(episode.state),
    reason: episode.reason,
    error: episode.error,
    attempts: episode.attempts,
    project_id: episode.projectId,
    session_id: episode.sessionId,
    request_id: episode.requestId,
    query: episode.query,
    subjects_json: JSON.stringify(z.array(LearningSubjectSchema).parse(episode.subjects)),
    context_json: JSON.stringify(LearningContextSchema.parse(episode.context)),
    outcome_json: JSON.stringify(LearningOutcomeSchema.parse(episode.outcome)),
    created_at_ms: episode.createdAtMs,
    updated_at_ms: episode.updatedAtMs,
  };
}

export function learningEpisodeResolutionRecord(
  id: string,
  resolution: AgentLearningEpisodeResolution,
): Record<string, unknown> {
  return {
    id,
    state: z.enum(AgentLearningStates).exclude(["Observed"]).parse(resolution.state),
    reason: resolution.reason,
    error: resolution.error ?? "",
    attempts: resolution.attempts ?? 1,
    updated_at_ms: resolution.updatedAtMs,
  };
}

export function rowToLearningEpisode(row: StoredLearningEpisodeRow): AgentLearningEpisode {
  return {
    id: row.id,
    domain: z.enum(AgentLearningDomains).parse(row.domain),
    state: z.enum(AgentLearningStates).parse(row.state),
    reason: row.reason,
    error: row.error,
    attempts: row.attempts,
    projectId: row.project_id,
    sessionId: row.session_id,
    requestId: row.request_id,
    query: row.query,
    subjects: z.array(LearningSubjectSchema).parse(parseJsonText(row.subjects_json, "Learning episode subjects")),
    context: LearningContextSchema.parse(parseJsonText(row.context_json, "Learning episode context")),
    outcome: LearningOutcomeSchema.parse(parseJsonText(row.outcome_json, "Learning episode outcome")),
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

export function skillLearningTermRecord(term: AgentSkillLearningTermAggregate): Record<string, unknown> {
  return {
    project_id: term.projectId,
    skill_name: term.skillName,
    skill_revision: term.skillRevision,
    term: term.term,
    source: term.source,
    support: term.support,
    weight: term.weight,
    last_seen_at: term.lastSeenAt,
  };
}

export function rowToSkillLearningTerm(row: StoredSkillLearningTermRow): AgentSkillLearningTermAggregate {
  return {
    projectId: row.project_id,
    skillName: row.skill_name,
    skillRevision: row.skill_revision,
    term: row.term,
    source: row.source,
    support: row.support,
    weight: row.weight,
    lastSeenAt: row.last_seen_at,
  };
}
