import path from "node:path";

export { InMemoryToolSearchMemoryStore } from "./AgentToolSearchInMemoryStore.js";
export { SqliteToolSearchMemoryStore } from "./AgentToolSearchSqliteMemoryStore.js";

export function resolveToolSearchMemoryDatabasePath(workspaceRoot: string, databasePath: string): string {
  return path.isAbsolute(databasePath)
    ? path.normalize(databasePath)
    : path.resolve(workspaceRoot, databasePath);
}

