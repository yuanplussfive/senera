import type Database from "better-sqlite3";
import type {
  StoredEpisodeRow,
  StoredPatternAggregateRow,
  StoredTermAggregateRow,
} from "./AgentToolSearchMemoryRows.js";

export interface ToolSearchMemorySqlStatements {
  insertEpisode: Database.Statement;
  insertTerm: Database.Statement;
  selectPattern: Database.Statement<[string, string, string], StoredPatternAggregateRow>;
  insertPattern: Database.Statement;
  updatePattern: Database.Statement;
  listEpisodes: Database.Statement<[string, number], StoredEpisodeRow>;
  listTerms: Database.Statement<[string], StoredTermAggregateRow>;
  listPatterns: Database.Statement<[string], StoredPatternAggregateRow>;
  pruneEpisodes: Database.Statement<[number]>;
}

export function prepareToolSearchMemorySqlStatements(
  db: Database.Database,
): ToolSearchMemorySqlStatements {
  return {
    insertEpisode: db.prepare(`
      INSERT INTO tool_search_episodes
        (
          query,
          query_tokens,
          planner_tags,
          candidates,
          chosen_tools,
          learned_keywords,
          outcome,
          calls,
          final_score,
          final_outcome,
          project_id,
          timestamp
        )
      VALUES
        (
          @query,
          @query_tokens,
          @planner_tags,
          @candidates,
          @chosen_tools,
          @learned_keywords,
          @outcome,
          @calls,
          @final_score,
          @final_outcome,
          @project_id,
          @timestamp
        )
    `),
    insertTerm: db.prepare(`
      INSERT INTO tool_learning_terms
        (
          project_id,
          tool_name,
          term,
          source,
          support,
          weight,
          last_seen_at
        )
      VALUES
        (
          @project_id,
          @tool_name,
          @term,
          @source,
          @support,
          @weight,
          @last_seen_at
        )
      ON CONFLICT(project_id, tool_name, term, source)
      DO UPDATE SET
        support = support + excluded.support,
        weight = MAX(weight, excluded.weight),
        last_seen_at = MAX(last_seen_at, excluded.last_seen_at)
    `),
    selectPattern: db.prepare<[string, string, string], StoredPatternAggregateRow>(`
      SELECT
        project_id,
        tool_name,
        pattern_key,
        trigger_terms,
        argument_keys,
        evidence_kinds,
        support,
        last_seen_at
      FROM tool_use_patterns
      WHERE project_id = ? AND tool_name = ? AND pattern_key = ?
    `),
    insertPattern: db.prepare(`
      INSERT INTO tool_use_patterns
        (
          project_id,
          tool_name,
          pattern_key,
          trigger_terms,
          argument_keys,
          evidence_kinds,
          support,
          last_seen_at
        )
      VALUES
        (
          @project_id,
          @tool_name,
          @pattern_key,
          @trigger_terms,
          @argument_keys,
          @evidence_kinds,
          @support,
          @last_seen_at
        )
    `),
    updatePattern: db.prepare(`
      UPDATE tool_use_patterns
      SET
        trigger_terms = @trigger_terms,
        argument_keys = @argument_keys,
        evidence_kinds = @evidence_kinds,
        support = @support,
        last_seen_at = @last_seen_at
      WHERE project_id = @project_id
        AND tool_name = @tool_name
        AND pattern_key = @pattern_key
    `),
    listEpisodes: db.prepare<[string, number], StoredEpisodeRow>(`
      SELECT
        query,
        query_tokens,
        planner_tags,
        candidates,
        chosen_tools,
        learned_keywords,
        outcome,
        calls,
        final_score,
        final_outcome,
        project_id,
        timestamp
      FROM tool_search_episodes
      WHERE project_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `),
    listTerms: db.prepare<[string], StoredTermAggregateRow>(`
      SELECT
        project_id,
        tool_name,
        term,
        source,
        support,
        weight,
        last_seen_at
      FROM tool_learning_terms
      WHERE project_id = ?
    `),
    listPatterns: db.prepare<[string], StoredPatternAggregateRow>(`
      SELECT
        project_id,
        tool_name,
        pattern_key,
        trigger_terms,
        argument_keys,
        evidence_kinds,
        support,
        last_seen_at
      FROM tool_use_patterns
      WHERE project_id = ?
    `),
    pruneEpisodes: db.prepare<[number]>(`
      DELETE FROM tool_search_episodes
      WHERE id NOT IN (
        SELECT id FROM tool_search_episodes ORDER BY timestamp DESC LIMIT ?
      )
    `),
  };
}

