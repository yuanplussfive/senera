import type Database from "better-sqlite3";
import { parseJsonText } from "../Core/AgentJsonParsing.js";
import {
  assertMatchingQueuedInput,
  type AgentSessionInputRepository,
  type AgentSessionQueuedInput,
} from "../Session/AgentSessionQueuedInput.js";

/** The row owns delivery state; the payload retains the original submission. */
export class AgentSqliteSessionInputStore implements AgentSessionInputRepository {
  constructor(private readonly db: Database.Database) {}

  loadQueuedInput(sessionId: string, requestId: string): AgentSessionQueuedInput | undefined {
    const row = this.db
      .prepare<[string, string], { payload: string }>(
        "SELECT payload FROM session_inputs WHERE session_id=? AND request_id=?",
      )
      .get(sessionId, requestId);
    return row ? decode(row.payload) : undefined;
  }

  listQueuedInputs(sessionId?: string): AgentSessionQueuedInput[] {
    const rows =
      sessionId === undefined
        ? this.db
            .prepare<[], { payload: string }>(
              "SELECT payload FROM session_inputs WHERE state IN ('pending','delivered') ORDER BY sequence",
            )
            .all()
        : this.db
            .prepare<[string], { payload: string }>(
              "SELECT payload FROM session_inputs WHERE session_id=? AND state IN ('pending','delivered') ORDER BY sequence",
            )
            .all(sessionId);
    return rows.map((row) => decode(row.payload));
  }

  saveQueuedInput(input: AgentSessionQueuedInput): void {
    const existing = this.loadQueuedInput(input.sessionId, input.requestId);
    if (existing) assertMatchingQueuedInput(existing, input);
    this.db
      .prepare(
        `INSERT INTO session_inputs(session_id,request_id,parent_request_id,state,payload)
      VALUES (@sessionId,@requestId,@parentRequestId,@state,@payload)
      ON CONFLICT(session_id,request_id) DO UPDATE SET
        parent_request_id=excluded.parent_request_id,state=excluded.state,payload=excluded.payload`,
      )
      .run({
        sessionId: input.sessionId,
        requestId: input.requestId,
        parentRequestId: input.parentRequestId,
        state: input.state,
        payload: JSON.stringify(input),
      });
  }
}

function decode(payload: string): AgentSessionQueuedInput {
  return parseJsonText(payload, "Session queued input") as AgentSessionQueuedInput;
}
