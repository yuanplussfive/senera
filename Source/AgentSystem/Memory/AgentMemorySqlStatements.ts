import type Database from "better-sqlite3";
import {
  prepareAgentMemoryEpisodeSqlStatements,
  type AgentMemoryEpisodeSqlStatements,
} from "./AgentMemoryEpisodeSqlStatements.js";
import {
  prepareAgentMemorySourceSqlStatements,
  type AgentMemorySourceSqlStatements,
} from "./AgentMemorySourceSqlStatements.js";

export interface AgentMemorySqlStatements extends AgentMemoryEpisodeSqlStatements, AgentMemorySourceSqlStatements {}

export function prepareAgentMemorySqlStatements(db: Database.Database): AgentMemorySqlStatements {
  return {
    ...prepareAgentMemoryEpisodeSqlStatements(db),
    ...prepareAgentMemorySourceSqlStatements(db),
  };
}
