import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import type { AgentInteractionContext } from "../Interaction/AgentInteractionContext.js";
import type { AgentMemoryDeletionImpact } from "../Memory/AgentMemorySourceRepository.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import type { AgentMemoryQualityData } from "./AgentMemoryRecallContract.js";
import { agentMemoryWeight } from "./AgentMemoryQuality.js";
import { AgentMemoryUtilitySqlStatements } from "./AgentMemoryUtilitySqlStatements.js";
import type { AgentMemoryUtilityOutcome } from "./AgentMemoryUtilityContract.js";
import { agentLegacyInteractionSubject } from "../Interaction/AgentInteractionIdentity.js";

export interface AgentMemorySubject {
  readonly id: string;
  readonly kind: "user" | "agent" | "unknown";
  readonly legacyIds?: readonly string[];
}

/** Channel identities are never implicitly merged with the console owner. */
export function agentMemorySubject(interaction?: AgentInteractionContext): AgentMemorySubject {
  if (interaction?.actor)
    return { id: interaction.actor.id, kind: interaction.actor.kind, legacyIds: interaction.actor.legacySubjectIds };
  if (!interaction || interaction.surface === "console") return { id: "owner", kind: "user" };
  return {
    id: agentLegacyInteractionSubject(interaction),
    kind: interaction.message?.senderId ? (interaction.message.senderKind ?? "user") : "unknown",
  };
}

export function agentMemorySubjectOwns(subject: AgentMemorySubject, subjectId: unknown): boolean {
  return typeof subjectId === "string" && (subject.id === subjectId || subject.legacyIds?.includes(subjectId) === true);
}

/** Recall counts distinct delivered tasks; SDK reads never count. */
export type AgentMemoryQuality = Readonly<AgentMemoryQualityData>;

export interface AgentMemoryDelivery {
  readonly id: string;
  readonly revision: string;
  readonly summary: string;
}

export interface AgentMemoryTaskBinding {
  readonly taskId: string;
  readonly subjectId: string;
  readonly actorKind: AgentMemorySubject["kind"];
}

/** Agent-local audit data. Semantic text/embeddings continue to belong to MemOS. */
export class AgentMemoryLearningLedger {
  private readonly db: Database.Database;
  private readonly utility: AgentMemoryUtilitySqlStatements;
  constructor(kernel: AgentSqliteDatabaseKernel) {
    this.db = kernel.connection;
    this.utility = new AgentMemoryUtilitySqlStatements(this.db);
  }

  task(
    input: {
      readonly sessionId: string;
      readonly requestId: string;
      readonly topicRelation?: "continue" | "new_topic";
      readonly resumeRequestId?: string;
      readonly subject?: AgentMemorySubject;
    },
    commit = true,
  ): AgentMemoryTaskBinding {
    const existing = this.binding(input.sessionId, input.requestId);
    const subject = input.subject ?? { id: "owner", kind: "user" };
    if (existing) {
      if (!agentMemorySubjectOwns(subject, existing.subjectId))
        throw new Error("A memory task request cannot change its subject.");
      return existing;
    }
    const resumed = input.resumeRequestId ? this.binding(input.sessionId, input.resumeRequestId) : undefined;
    if (input.resumeRequestId && (!resumed || !agentMemorySubjectOwns(subject, resumed.subjectId)))
      throw new Error("A resumed memory task must belong to this session and subject.");
    const previous = resumed
      ? { task_id: resumed.taskId }
      : input.topicRelation === "continue"
        ? this.db
            .prepare<[string, string], { task_id: string }>(
              "SELECT task_id FROM memory_task_requests WHERE session_id=? AND subject_id IN (SELECT value FROM json_each(?)) ORDER BY rowid DESC LIMIT 1",
            )
            .get(input.sessionId, JSON.stringify([subject.id, ...(subject.legacyIds ?? [])]))
        : undefined;
    const binding = {
      taskId: previous?.task_id ?? sha256HexOfCanonicalJson([input.sessionId, input.requestId, subject.id]),
      subjectId: subject.id,
      actorKind: subject.kind,
    };
    if (commit)
      this.db
        .prepare(
          "INSERT INTO memory_task_requests(session_id,request_id,task_id,subject_id,actor_kind,started_at) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING",
        )
        .run(
          input.sessionId,
          input.requestId,
          binding.taskId,
          binding.subjectId,
          binding.actorKind,
          new Date().toISOString(),
        );
    return binding;
  }

  binding(sessionId: string, requestId: string): AgentMemoryTaskBinding | undefined {
    const row = this.db
      .prepare<[string, string], { task_id: string; subject_id: string; actor_kind: AgentMemorySubject["kind"] }>(
        "SELECT task_id,subject_id,actor_kind FROM memory_task_requests WHERE session_id=? AND request_id=?",
      )
      .get(sessionId, requestId);
    return row ? { taskId: row.task_id, subjectId: row.subject_id, actorKind: row.actor_kind } : undefined;
  }

  /** One durable reference per task, used by the existing state-card rewrite to resume topics. */
  resumableTasks(
    sessionId: string,
    subject: string | AgentMemorySubject = "owner",
  ): readonly { readonly requestId: string; readonly request: string }[] {
    return this.db
      .prepare<[string, string], { requestId: string; request: string }>(
        `SELECT request_id AS requestId,standalone_request AS request FROM (
        SELECT t.request_id,e.standalone_request,t.rowid,
          row_number() OVER (PARTITION BY t.task_id ORDER BY t.rowid DESC) AS position
        FROM memory_task_requests t JOIN memory_episodes e USING(session_id,request_id)
        WHERE t.session_id=? AND t.subject_id IN (SELECT value FROM json_each(?))
      ) WHERE position=1 ORDER BY rowid DESC`,
      )
      .all(
        sessionId,
        JSON.stringify(typeof subject === "string" ? [subject] : [subject.id, ...(subject.legacyIds ?? [])]),
      );
  }

  register(nodeId: string): void {
    const inserted = this.db
      .prepare("INSERT INTO memory_knowledge_scores(node_id) VALUES(?) ON CONFLICT DO NOTHING")
      .run(nodeId);
    if (inserted.changes) this.scoresChanged([nodeId]);
  }

  retractUtility(sessionId: string, requestId: string): void {
    const affected = this.db
      .prepare<[string, string], { node_id: string }>(
        "SELECT node_id FROM memory_utility_settlements WHERE session_id=? AND request_id=?",
      )
      .all(sessionId, requestId);
    this.db
      .prepare("DELETE FROM memory_utility_settlements WHERE session_id=? AND request_id=?")
      .run(sessionId, requestId);
    this.scoresChanged(affected.map((row) => row.node_id));
  }

  /** Replacing a model assessment is atomic: failed settlement preserves the previous one. */
  reconcileAssessment(sessionId: string, requestId: string, apply: () => void): void {
    this.db.transaction(() => {
      this.retractUtility(sessionId, requestId);
      apply();
    })();
  }

  completeRecall(sessionId: string, requestId: string, completedAt: string): void {
    if (!this.binding(sessionId, requestId)) return;
    this.db.transaction(() => {
      const completed = this.db
        .prepare(
          "INSERT INTO memory_task_completions(session_id,request_id,completed_at) VALUES(?,?,?) ON CONFLICT DO NOTHING",
        )
        .run(sessionId, requestId, completedAt);
      if (completed.changes) this.scoresChanged(this.delivered(sessionId, requestId).map((entry) => entry.id));
    })();
  }

  /** Coalesce SDK repair by revision; weights remain authoritative in this ledger. */
  pendingScoreUpdates(): readonly { nodeId: string; revision: string }[] {
    return this.db
      .prepare<[], { node_id: string; revision: string }>(
        "SELECT node_id,revision FROM memory_score_sync ORDER BY node_id",
      )
      .all()
      .map((row) => ({ nodeId: row.node_id, revision: row.revision }));
  }

  acknowledgeScoreUpdate(nodeId: string, revision: string): void {
    this.db.prepare("DELETE FROM memory_score_sync WHERE node_id=? AND revision=?").run(nodeId, revision);
  }

  private scoresChanged(nodeIds: readonly string[]): void {
    const statement = this.db.prepare(
      "INSERT INTO memory_score_sync(node_id,revision) VALUES(?,?) ON CONFLICT(node_id) DO UPDATE SET revision=excluded.revision",
    );
    for (const nodeId of new Set(nodeIds)) statement.run(nodeId, randomUUID());
  }

  quality(nodeId: string): AgentMemoryQuality {
    const row = this.utility.counts(nodeId);
    return {
      weight: agentMemoryWeight(row.helpful, row.unhelpful),
      recallCount: row.recall_count,
      helpfulCount: row.helpful,
      unhelpfulCount: row.unhelpful,
      unusedCount: row.unused,
      uncertainCount: row.uncertain,
      pendingCount: row.recall_count - row.helpful - row.unhelpful - row.unused - row.uncertain,
    };
  }

  stageDelivery(
    sessionId: string,
    requestId: string,
    entries: readonly AgentMemoryDelivery[],
    delivery: "snapshot" | "task" | "explicit",
  ): void {
    const binding = this.binding(sessionId, requestId);
    if (!binding) throw new Error("Memory delivery requires a bound task.");
    this.db.transaction(() => {
      if (delivery !== "explicit")
        this.db
          .prepare(
            "DELETE FROM memory_recall_receipts WHERE session_id=? AND request_id=? AND delivery=? AND delivered=0",
          )
          .run(sessionId, requestId, delivery);
      const statement = this.db.prepare(
        "INSERT INTO memory_recall_receipts(session_id,request_id,task_id,node_id,revision,summary,delivery) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
      );
      for (const entry of entries) {
        this.register(entry.id);
        statement.run(sessionId, requestId, binding.taskId, entry.id, entry.revision, entry.summary, delivery);
      }
    })();
  }

  markDelivered(sessionId: string, requestId: string): void {
    this.db.transaction(() => {
      const changed = this.db
        .prepare("UPDATE memory_recall_receipts SET delivered=1 WHERE session_id=? AND request_id=? AND delivered=0")
        .run(sessionId, requestId);
      if (changed.changes) this.scoresChanged(this.delivered(sessionId, requestId).map((entry) => entry.id));
    })();
  }

  delivered(sessionId: string, requestId: string): readonly AgentMemoryDelivery[] {
    return this.db
      .prepare<[string, string], { id: string; revision: string; summary: string }>(
        "SELECT DISTINCT node_id id,revision,summary FROM memory_recall_receipts WHERE session_id=? AND request_id=? AND delivered=1 ORDER BY node_id,revision",
      )
      .all(sessionId, requestId);
  }

  settleUtility(
    sessionId: string,
    requestId: string,
    nodeId: string,
    outcome: AgentMemoryUtilityOutcome,
    reason: string,
  ): void {
    const binding = this.binding(sessionId, requestId);
    if (!binding || !this.delivered(sessionId, requestId).some((entry) => entry.id === nodeId)) {
      throw new Error("Memory usefulness can only assess a memory delivered to this request.");
    }
    if (!reason.trim()) throw new Error("Memory task assessment requires a reason.");
    this.utility.settle({ sessionId, requestId, taskId: binding.taskId, nodeId, outcome, reason });
    this.scoresChanged([nodeId]);
  }

  deleteSources(impact: AgentMemoryDeletionImpact): void {
    this.db.transaction(() => {
      if (!impact.scope || impact.scope === "session")
        this.db.prepare("DELETE FROM memory_task_requests WHERE session_id=?").run(impact.sessionId);
      else
        for (const id of impact.requestIds ?? (impact.requestId ? [impact.requestId] : []))
          this.db
            .prepare("DELETE FROM memory_task_requests WHERE session_id=? AND request_id=?")
            .run(impact.sessionId, id);
      // Source/task removal retracts the corresponding task utility.
      this.db
        .prepare(
          `INSERT INTO memory_score_sync(node_id,revision)
        SELECT node_id,lower(hex(randomblob(16))) FROM memory_knowledge_scores WHERE true
        ON CONFLICT(node_id) DO UPDATE SET revision=excluded.revision`,
        )
        .run();
    })();
  }

  forget(nodeId: string): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM memory_knowledge_scores WHERE node_id=?").run(nodeId);
      this.db.prepare("DELETE FROM memory_recall_receipts WHERE node_id=?").run(nodeId);
      this.db.prepare("DELETE FROM memory_utility_settlements WHERE node_id=?").run(nodeId);
    })();
  }
}
