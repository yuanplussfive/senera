import type Database from "better-sqlite3";
import type { StepTrace } from "../Runtime/AgentStepTrace.js";
import { entryToRow } from "../SessionPersistence/AgentSessionCodec.js";
import type { AgentSessionSqlStatements } from "../SessionPersistence/AgentSessionSqlStatements.js";
import type { AgentConversationEntry } from "../Conversation/AgentConversation.js";
import type {
  AgentSessionCursorPage,
  AgentStepTraceCursor,
  AgentStepTracePageRequest,
  StoredStepTraceRun,
} from "./AgentSessionRepository.js";
import { parseJsonText } from "../Core/AgentJsonParsing.js";
import { assertAgentSessionRepositoryPageSize } from "./AgentSessionHistoryPaging.js";

export class AgentSqliteSessionTraceStore {
  constructor(
    private readonly db: Database.Database,
    private readonly stmts: AgentSessionSqlStatements,
  ) {}

  appendEntries(sessionId: string, entries: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>): void {
    if (entries.length === 0) return;
    const insert = this.db.transaction((items: ReadonlyArray<{ entry: AgentConversationEntry; sequence: number }>) => {
      for (const { entry, sequence } of items) {
        this.stmts.appendEntry.run(entryToRow(sessionId, entry, sequence));
      }
    });
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
      run.traces.push(parseJsonText(row.data, "Step trace") as StepTrace);
      byRequest.set(row.request_id, run);
    }
    return Array.from(byRequest.values()).sort((a, b) => a.turnSequence - b.turnSequence);
  }

  loadStepTracePage(
    sessionId: string,
    request: AgentStepTracePageRequest,
  ): AgentSessionCursorPage<StoredStepTraceRun, AgentStepTraceCursor> {
    const pageSize = assertAgentSessionRepositoryPageSize(request.pageSize);
    const after = request.after ?? InitialStepTraceCursor;
    const keys = this.stmts.selectStepTraceRunKeys.all(
      sessionId,
      request.throughRowId,
      after.turnSequence,
      after.turnSequence,
      after.requestId,
      pageSize + 1,
    );
    const pageKeys = keys.slice(0, pageSize);
    const last = pageKeys.at(-1);
    if (!last) return { items: [] };

    const rows = this.stmts.selectStepTracePage.all(
      sessionId,
      request.throughRowId,
      after.turnSequence,
      after.turnSequence,
      after.requestId,
      last.turn_sequence,
      last.turn_sequence,
      last.request_id,
    );
    const byRequest = new Map<string, StoredStepTraceRun>();
    for (const row of rows) {
      const key = stepTraceRunKey(row.turn_sequence, row.request_id);
      const run = byRequest.get(key) ?? {
        requestId: row.request_id,
        turnSequence: row.turn_sequence,
        traces: [],
      };
      run.traces.push(parseJsonText(row.data, "Step trace") as StepTrace);
      byRequest.set(key, run);
    }
    return {
      items: [...byRequest.values()],
      nextCursor: keys.length > pageSize ? { turnSequence: last.turn_sequence, requestId: last.request_id } : undefined,
    };
  }
}

const InitialStepTraceCursor: AgentStepTraceCursor = Object.freeze({
  turnSequence: -1,
  requestId: "",
});

function stepTraceRunKey(turnSequence: number, requestId: string): string {
  return `${turnSequence}:${requestId}`;
}
