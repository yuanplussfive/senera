import type { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import { stringifyAgentCanonicalJson } from "../Core/AgentCanonicalJson.js";
import { readAgentPiCompactionCandidate, type AgentPiCompactionCandidate } from "./AgentPiCompactionCandidate.js";

export interface AgentPiCompactionCandidateStore {
  replace(candidate: AgentPiCompactionCandidate): void;
  list(sessionId: string): AgentPiCompactionCandidate[];
  remove(candidateId: string): void;
  removeSession(sessionId: string): void;
}

/** SQLite-backed derived cache. Candidate loss never compromises Pi history. */
export class AgentPiCompactionCandidateSqliteStore implements AgentPiCompactionCandidateStore {
  constructor(private readonly database: AgentSqliteDatabaseKernel) {}

  replace(candidate: AgentPiCompactionCandidate): void {
    const connection = this.database.connection;
    const replace = connection.transaction((value: AgentPiCompactionCandidate) => {
      connection
        .prepare("DELETE FROM pi_compaction_candidates WHERE session_id = @sessionId AND branch_epoch IS @branchEpoch")
        .run({ sessionId: value.sessionId, branchEpoch: value.branchEpoch });
      connection
        .prepare(
          `INSERT INTO pi_compaction_candidates (
             candidate_id, session_id, branch_epoch, snapshot_leaf_id, created_at, candidate_json
           ) VALUES (
             @candidateId, @sessionId, @branchEpoch, @snapshotLeafId, @createdAt, @candidateJson
           )`,
        )
        .run({
          candidateId: value.id,
          sessionId: value.sessionId,
          branchEpoch: value.branchEpoch,
          snapshotLeafId: value.snapshotLeafId,
          createdAt: value.createdAt,
          candidateJson: stringifyAgentCanonicalJson(value),
        });
    });
    replace(candidate);
  }

  list(sessionId: string): AgentPiCompactionCandidate[] {
    const rows = this.database.connection
      .prepare<
        [string],
        {
          readonly candidate_id: string;
          readonly session_id: string;
          readonly branch_epoch: string | null;
          readonly snapshot_leaf_id: string;
          readonly candidate_json: string;
        }
      >(
        `SELECT candidate_id, session_id, branch_epoch, snapshot_leaf_id, candidate_json
         FROM pi_compaction_candidates
         WHERE session_id = ?
         ORDER BY created_at DESC, candidate_id DESC`,
      )
      .all(sessionId);
    const candidates: AgentPiCompactionCandidate[] = [];
    for (const row of rows) {
      const candidate = parseCandidate(row);
      if (candidate) candidates.push(candidate);
      else this.remove(row.candidate_id);
    }
    return candidates;
  }

  remove(candidateId: string): void {
    this.database.connection.prepare("DELETE FROM pi_compaction_candidates WHERE candidate_id = ?").run(candidateId);
  }

  removeSession(sessionId: string): void {
    this.database.connection.prepare("DELETE FROM pi_compaction_candidates WHERE session_id = ?").run(sessionId);
  }
}

/** Explicit volatile adapter for isolated SDK/test hosts that do not own Senera's memory database. */
export class AgentPiCompactionCandidateMemoryStore implements AgentPiCompactionCandidateStore {
  private readonly candidates = new Map<string, AgentPiCompactionCandidate>();

  replace(candidate: AgentPiCompactionCandidate): void {
    for (const [id, current] of this.candidates) {
      if (current.sessionId === candidate.sessionId && current.branchEpoch === candidate.branchEpoch) {
        this.candidates.delete(id);
      }
    }
    this.candidates.set(candidate.id, candidate);
  }

  list(sessionId: string): AgentPiCompactionCandidate[] {
    return [...this.candidates.values()]
      .filter((candidate) => candidate.sessionId === sessionId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
  }

  remove(candidateId: string): void {
    this.candidates.delete(candidateId);
  }

  removeSession(sessionId: string): void {
    for (const [id, candidate] of this.candidates) {
      if (candidate.sessionId === sessionId) this.candidates.delete(id);
    }
  }
}

function parseCandidate(input: {
  readonly candidate_id: string;
  readonly session_id: string;
  readonly branch_epoch: string | null;
  readonly snapshot_leaf_id: string;
  readonly candidate_json: string;
}): AgentPiCompactionCandidate | undefined {
  try {
    const candidate = readAgentPiCompactionCandidate(JSON.parse(input.candidate_json));
    if (!candidate) return undefined;
    return candidate.id === input.candidate_id &&
      candidate.sessionId === input.session_id &&
      candidate.branchEpoch === input.branch_epoch &&
      candidate.snapshotLeafId === input.snapshot_leaf_id
      ? candidate
      : undefined;
  } catch {
    return undefined;
  }
}
