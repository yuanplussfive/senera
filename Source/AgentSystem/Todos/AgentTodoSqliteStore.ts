import type Database from "better-sqlite3";
import { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import type { AgentTodoItem, AgentTodoStatus } from "./AgentTodoTypes.js";

interface TodoRow {
  id: string;
  session_id: string;
  item_order: number;
  content: string;
  status: AgentTodoStatus;
  created_at: string;
  updated_at: string;
}

export class AgentTodoSqliteStore {
  private readonly db: Database.Database;

  constructor(database: AgentSqliteDatabaseKernel | Database.Database) {
    this.db = database instanceof AgentSqliteDatabaseKernel ? database.connection : database;
  }

  list(sessionId: string): AgentTodoItem[] {
    const normalizedSessionId = requireText(sessionId, "Todo session id");
    return this.db
      .prepare<unknown[], TodoRow>(
        `SELECT id, session_id, item_order, content, status, created_at, updated_at
         FROM agent_todos
         WHERE session_id = ?
         ORDER BY item_order ASC, id ASC`,
      )
      .all(normalizedSessionId)
      .map(projectTodo);
  }

  replace(sessionId: string, items: readonly AgentTodoItem[]): void {
    const normalizedSessionId = requireText(sessionId, "Todo session id");
    const now = new Date().toISOString();
    const transaction = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM agent_todos WHERE session_id = ?`).run(normalizedSessionId);
      const insert = this.db.prepare(
        `INSERT INTO agent_todos
          (id, session_id, item_order, content, status, created_at, updated_at)
         VALUES (@id, @session_id, @item_order, @content, @status, @created_at, @updated_at)`,
      );
      for (const item of items) {
        insert.run({
          id: requireText(item.id, "Todo id"),
          session_id: normalizedSessionId,
          item_order: item.order,
          content: requireText(item.content, "Todo content"),
          status: item.status,
          created_at: item.createdAt || now,
          updated_at: item.updatedAt || now,
        });
      }
    });
    transaction();
  }
}

function projectTodo(row: TodoRow): AgentTodoItem {
  return {
    id: row.id,
    content: row.content,
    status: row.status,
    order: row.item_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} cannot be empty.`);
  return normalized;
}
