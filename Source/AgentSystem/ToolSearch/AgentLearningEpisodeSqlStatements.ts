import type Database from "better-sqlite3";
import type {
  StoredCountRow,
  StoredLearningEpisodeCountRow,
  StoredLearningEpisodeRow,
  StoredSkillLearningTermRow,
} from "./AgentLearningEpisodeRows.js";

export interface AgentLearningEpisodeSqlStatements {
  insertLearningEpisode: Database.Statement;
  updateLearningEpisode: Database.Statement;
  listLearningEpisodes: Database.Statement<[string, number], StoredLearningEpisodeRow>;
  selectLearningEpisode: Database.Statement<[string, string], StoredLearningEpisodeRow>;
  summarizeLearningEpisodes: Database.Statement<[string], StoredLearningEpisodeCountRow>;
  countSkillLearningTerms: Database.Statement<[string], StoredCountRow>;
  insertSkillLearningTerm: Database.Statement;
  listSkillLearningTerms: Database.Statement<[string], StoredSkillLearningTermRow>;
}

export function prepareAgentLearningEpisodeSqlStatements(db: Database.Database): AgentLearningEpisodeSqlStatements {
  return {
    insertLearningEpisode: db.prepare(`
      INSERT INTO learning_episodes (
        id, domain, state, reason, error, attempts, project_id, session_id, request_id,
        query, subjects_json, context_json, outcome_json, created_at_ms, updated_at_ms
      ) VALUES (
        @id, @domain, @state, @reason, @error, @attempts, @project_id, @session_id, @request_id,
        @query, @subjects_json, @context_json, @outcome_json, @created_at_ms, @updated_at_ms
      )
    `),
    updateLearningEpisode: db.prepare(`
      UPDATE learning_episodes
      SET state = @state, reason = @reason, error = @error, attempts = @attempts, updated_at_ms = @updated_at_ms
      WHERE id = @id
    `),
    listLearningEpisodes: db.prepare<[string, number], StoredLearningEpisodeRow>(`
      SELECT * FROM learning_episodes
      WHERE project_id = ?
      ORDER BY updated_at_ms DESC, id ASC
      LIMIT ?
    `),
    selectLearningEpisode: db.prepare<[string, string], StoredLearningEpisodeRow>(`
      SELECT * FROM learning_episodes
      WHERE project_id = ? AND id = ?
    `),
    summarizeLearningEpisodes: db.prepare<[string], StoredLearningEpisodeCountRow>(`
      SELECT domain, state, COUNT(*) AS count
      FROM learning_episodes
      WHERE project_id = ?
      GROUP BY domain, state
      ORDER BY domain ASC, state ASC
    `),
    countSkillLearningTerms: db.prepare<[string], StoredCountRow>(`
      SELECT COUNT(*) AS count
      FROM skill_learning_terms
      WHERE project_id = ?
    `),
    insertSkillLearningTerm: db.prepare(`
      INSERT INTO skill_learning_terms (
        project_id, skill_name, skill_revision, term, source, support, weight, last_seen_at
      ) VALUES (
        @project_id, @skill_name, @skill_revision, @term, @source, @support, @weight, @last_seen_at
      )
      ON CONFLICT(project_id, skill_name, skill_revision, term, source)
      DO UPDATE SET
        support = support + excluded.support,
        weight = MAX(weight, excluded.weight),
        last_seen_at = MAX(last_seen_at, excluded.last_seen_at)
    `),
    listSkillLearningTerms: db.prepare<[string], StoredSkillLearningTermRow>(`
      SELECT project_id, skill_name, skill_revision, term, source, support, weight, last_seen_at
      FROM skill_learning_terms
      WHERE project_id = ?
    `),
  };
}
