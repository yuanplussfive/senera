import type Database from "better-sqlite3";
import type { MemoryItemVectorRow } from "./AgentMemorySqlRows.js";

export interface AgentMemoryVectorSqlStatements {
  upsertMemoryItemVectorStmt: Database.Statement;
  listMemoryItemVectorsStmt: Database.Statement<[string], MemoryItemVectorRow>;
}

export function prepareAgentMemoryVectorSqlStatements(db: Database.Database): AgentMemoryVectorSqlStatements {
  return {
    upsertMemoryItemVectorStmt: db.prepare(`
      INSERT INTO memory_item_vectors (
        memory_uri,
        model,
        dimensions,
        embedding_json,
        updated_at,
        updated_at_ms
      )
      VALUES (
        @memory_uri,
        @model,
        @dimensions,
        @embedding_json,
        @updated_at,
        @updated_at_ms
      )
      ON CONFLICT(memory_uri, model) DO UPDATE SET
        dimensions = excluded.dimensions,
        embedding_json = excluded.embedding_json,
        updated_at = excluded.updated_at,
        updated_at_ms = excluded.updated_at_ms
    `),
    listMemoryItemVectorsStmt: db.prepare<[string], MemoryItemVectorRow>(`
      SELECT * FROM memory_item_vectors
      WHERE model = ?
      ORDER BY updated_at_ms DESC, memory_uri ASC
    `),
  };
}
