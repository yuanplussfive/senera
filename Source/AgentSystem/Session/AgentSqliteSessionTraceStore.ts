import type Database from "better-sqlite3";
import type { StepTrace } from "../Runtime/AgentStepTrace.js";
import { entryToRow } from "../SessionPersistence/AgentSessionCodec.js";
import type { AgentSessionSqlStatements } from "../SessionPersistence/AgentSessionSqlStatements.js";
import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type { StoredStepTraceRun } from "./AgentSessionRepository.js";

export class AgentSqliteSessionTraceStore {
  constructor(
    private readonly db: Database.Database,
    private readonly stmts: AgentSessionSqlStatements,
  ) {}

  appendEntries(
    sessionId: string,
    entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>,
  ): void {
    if (entries.length === 0) return;
    const insert = this.db.transaction(
      (items: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>) => {
        for (const { entry, sequence } of items) {
          this.stmts.appendEntry.run(entryToRow(sessionId, entry, sequence));
        }
      },
    );
    insert(entries);
  }

  persistTurnArtifacts(
    sessionId: string,
    entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>,
    traces: ReadonlyArray<{ requestId: string; turnSequence: number; trace: StepTrace }>,
  ): void {
    if (entries.length === 0 && traces.length === 0) return;
    const persist = this.db.transaction(() => {
      for (const { entry, sequence } of entries) {
        this.stmts.appendEntry.run(entryToRow(sessionId, entry, sequence));
      }
      for (const { requestId, turnSequence, trace } of traces) {
        this.stmts.appendStepTrace.run({
          session_id: sessionId,
          request_id: requestId,
          turn_sequence: turnSequence,
          step: trace.step,
          seq: trace.seq,
          data: JSON.stringify(trace),
        });
      }
    });
    persist();
  }

  loadStepTraces(sessionId: string): StoredStepTraceRun[] {
    const byRequest = new Map<string, StoredStepTraceRun>();
    for (const row of this.stmts.selectStepTraces.all(sessionId)) {
      const run = byRequest.get(row.request_id) ?? {
        requestId: row.request_id,
        turnSequence: row.turn_sequence,
        traces: [],
      };
      run.traces.push(JSON.parse(row.data) as StepTrace);
      byRequest.set(row.request_id, run);
    }
    return Array.from(byRequest.values()).sort((a, b) => a.turnSequence - b.turnSequence);
  }
}
