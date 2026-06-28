import type Database from "better-sqlite3";
import {
  prepareAgentMemoryCandidateSqlStatements,
  type AgentMemoryCandidateSqlStatements,
} from "./AgentMemoryCandidateSqlStatements.js";
import {
  prepareAgentMemoryEpisodeSqlStatements,
  type AgentMemoryEpisodeSqlStatements,
} from "./AgentMemoryEpisodeSqlStatements.js";
import {
  prepareAgentMemoryItemSqlStatements,
  type AgentMemoryItemSqlStatements,
} from "./AgentMemoryItemSqlStatements.js";
import {
  prepareAgentMemoryObservationSqlStatements,
  type AgentMemoryObservationSqlStatements,
} from "./AgentMemoryObservationSqlStatements.js";
import {
  prepareAgentMemorySourceSqlStatements,
  type AgentMemorySourceSqlStatements,
} from "./AgentMemorySourceSqlStatements.js";
import {
  prepareAgentMemoryVectorSqlStatements,
  type AgentMemoryVectorSqlStatements,
} from "./AgentMemoryVectorSqlStatements.js";

export interface AgentMemorySqlStatements
  extends AgentMemoryEpisodeSqlStatements,
    AgentMemorySourceSqlStatements,
    AgentMemoryCandidateSqlStatements,
    AgentMemoryItemSqlStatements,
    AgentMemoryObservationSqlStatements,
    AgentMemoryVectorSqlStatements {}

export function prepareAgentMemorySqlStatements(db: Database.Database): AgentMemorySqlStatements {
  return {
    ...prepareAgentMemoryEpisodeSqlStatements(db),
    ...prepareAgentMemorySourceSqlStatements(db),
    ...prepareAgentMemoryCandidateSqlStatements(db),
    ...prepareAgentMemoryItemSqlStatements(db),
    ...prepareAgentMemoryObservationSqlStatements(db),
    ...prepareAgentMemoryVectorSqlStatements(db),
  };
}

