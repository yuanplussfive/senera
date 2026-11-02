import type Database from "better-sqlite3";
import { agentSql } from "../Database/AgentSql.js";
import { AgentMemoryUtilityVersion, type AgentMemoryUtilityOutcome } from "./AgentMemoryUtilityContract.js";

interface UtilityCounts {
  recall_count: number;
  helpful: number;
  unhelpful: number;
  unused: number;
  uncertain: number;
}

/** Completed tasks vote once. Unused follow-ups do not erase earlier effective use. */
export class AgentMemoryUtilitySqlStatements {
  private readonly countsStatement;
  private readonly settleStatement;

  constructor(db: Database.Database) {
    this.countsStatement = db.prepare<{ nodeId: string; version: number }, UtilityCounts>(agentSql`
      WITH latest_utility AS (
        SELECT u.task_id,u.outcome,
          row_number() OVER (PARTITION BY u.task_id ORDER BY
            CASE WHEN u.outcome IN ('helpful','unhelpful') THEN 0 ELSE 1 END,t.rowid DESC) latest
        FROM memory_utility_settlements u
        JOIN memory_task_requests t ON t.session_id=u.session_id AND t.request_id=u.request_id
        JOIN memory_task_completions c ON c.session_id=u.session_id AND c.request_id=u.request_id
        WHERE u.node_id=@nodeId AND u.contract_version=@version
      )
      SELECT
        (SELECT count(DISTINCT task_id) FROM memory_recall_receipts
          WHERE node_id=@nodeId AND delivered=1) recall_count,
        count(CASE WHEN latest=1 AND outcome='helpful' THEN 1 END) helpful,
        count(CASE WHEN latest=1 AND outcome='unhelpful' THEN 1 END) unhelpful,
        count(CASE WHEN latest=1 AND outcome='unused' THEN 1 END) unused,
        count(CASE WHEN latest=1 AND outcome='uncertain' THEN 1 END) uncertain
      FROM latest_utility
    `);
    this.settleStatement = db.prepare(agentSql`
      INSERT INTO memory_utility_settlements(session_id,request_id,task_id,node_id,outcome,reason,contract_version)
      VALUES(@sessionId,@requestId,@taskId,@nodeId,@outcome,@reason,@version)
      ON CONFLICT(session_id,request_id,node_id) DO UPDATE SET
        outcome=excluded.outcome,reason=excluded.reason,contract_version=excluded.contract_version
    `);
  }

  counts(nodeId: string): UtilityCounts {
    return this.countsStatement.get({ nodeId, version: AgentMemoryUtilityVersion })!;
  }

  settle(input: {
    sessionId: string;
    requestId: string;
    taskId: string;
    nodeId: string;
    outcome: AgentMemoryUtilityOutcome;
    reason: string;
  }): void {
    this.settleStatement.run({ ...input, version: AgentMemoryUtilityVersion });
  }
}
