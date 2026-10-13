import { getLoadablePath as getSqliteVecLoadablePath } from "sqlite-vec";
import type Database from "better-sqlite3";
import { resolveAsarUnpackedExecutablePath } from "../Core/AgentExecutablePath.js";
import type { AgentSqliteDatabaseExtension } from "./AgentSqliteDatabaseKernel.js";

const loadedDatabases = new WeakSet<object>();

/** Loads sqlite-vec once for a better-sqlite3 connection. */
export function loadAgentSqliteVec(database: Database.Database): void {
  if (loadedDatabases.has(database)) return;
  database.loadExtension(resolveAsarUnpackedExecutablePath(getSqliteVecLoadablePath()));
  loadedDatabases.add(database);
}

export const AgentSqliteVecExtension: AgentSqliteDatabaseExtension = Object.freeze({
  id: "sqlite-vec",
  load: loadAgentSqliteVec,
});

/** Extensions required by the authoritative memory database. */
export const AgentMemorySqliteExtensions = Object.freeze([AgentSqliteVecExtension] as const);
