import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { stableMemoryId } from "../Memory/AgentMemoryIdentity.js";
import { parseJsonText } from "../Core/AgentJsonParsing.js";
import {
  normalizeAgentTextValue,
  parseAgentTextParts,
  projectLegacyIdentityText,
  renderAgentTextParts,
  type AgentTextParts,
} from "../Text/AgentTextParts.js";
import type { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import type {
  AgentTemporalMemoryDigest,
  AgentTemporalMemoryDigestJob,
  AgentTemporalMemoryDigestMember,
  AgentTemporalMemoryDigestStatus,
  AgentTemporalMemoryGranularity,
  AgentTemporalMemoryOverview,
  AgentTemporalMemoryScope,
  AgentTemporalMemorySummaryResult,
  AgentConversationSegmentDecision,
  AgentConversationSegmentDecisionRelation,
} from "./AgentTemporalMemoryTypes.js";

interface DigestRow {
  readonly id: string;
  readonly uri: string;
  readonly scope_key: string;
  readonly workspace_id: string;
  readonly account_id: string | null;
  readonly user_id: string | null;
  readonly world_id: string | null;
  readonly granularity: AgentTemporalMemoryGranularity;
  readonly digest_key: string;
  readonly session_id: string;
  readonly period_start: string;
  readonly period_end: string;
  readonly period_start_ms: number;
  readonly period_end_ms: number;
  readonly time_zone: string;
  readonly status: AgentTemporalMemoryDigestStatus;
  readonly working_focus: string;
  readonly summary: string;
  readonly topics_json: string;
  readonly open_loops_json: string;
  readonly summary_parts_json: string;
  readonly topics_parts_json: string;
  readonly open_loops_parts_json: string;
  readonly source_revision: string;
  readonly child_count: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface MemberRow {
  readonly digest_id: string;
  readonly member_uri: string;
  readonly member_kind: "episode" | "digest";
  readonly ordinal: number;
  readonly occurred_at: string;
  readonly source_revision: string;
}

interface JobRow {
  readonly digest_id: string;
  readonly next_attempt_at_ms: number;
  readonly attempt_count: number;
  readonly last_error: string | null;
  readonly updated_at: string;
}

interface SegmentDecisionRow {
  readonly episode_uri: string;
  readonly scope_key: string;
  readonly session_id: string;
  readonly source_revision: string;
  readonly completed_at_ms: number;
  readonly status: AgentConversationSegmentDecision["status"];
  readonly relation: AgentConversationSegmentDecisionRelation | null;
  readonly confidence: number | null;
  readonly predecessor_digest_uri: string | null;
  readonly assigned_digest_uri: string | null;
  readonly next_attempt_at_ms: number;
  readonly attempt_count: number;
  readonly last_error: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface AgentTemporalMemoryDigestCreation {
  readonly scope: AgentTemporalMemoryScope;
  readonly granularity: AgentTemporalMemoryGranularity;
  readonly digestKey: string;
  readonly sessionId?: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly timeZone: string;
  readonly status: AgentTemporalMemoryDigestStatus;
  readonly now: string;
}

export interface AgentTemporalMemoryMemberInput {
  readonly memberUri: string;
  readonly memberKind: "episode" | "digest";
  readonly occurredAt: string;
  readonly sourceRevision: string;
}

/** SQLite boundary for the derived temporal-summary DAG and its durable work queue. */
export class AgentTemporalMemorySqliteStore {
  private readonly db: Database.Database;

  constructor(database: AgentSqliteDatabaseKernel | Database.Database) {
    this.db = "connection" in database ? database.connection : database;
  }

  ensureDigest(input: AgentTemporalMemoryDigestCreation): AgentTemporalMemoryDigest {
    const id = stableMemoryId("digest", [input.scope.key, input.granularity, input.digestKey]);
    const uri = `senera://memory-digest/${id}`;
    const startMs = parseInstantMs(input.periodStart, "digest period start");
    const endMs = parseInstantMs(input.periodEnd, "digest period end");
    if (endMs < startMs) throw new Error("Temporal digest period end cannot precede its start.");
    this.db
      .prepare(
        `INSERT INTO memory_temporal_digests
          (id, uri, scope_key, workspace_id, account_id, user_id, world_id, granularity, digest_key,
           session_id, period_start, period_end, period_start_ms, period_end_ms, time_zone, status,
           working_focus, summary, topics_json, open_loops_json, source_revision, child_count, created_at, updated_at)
         VALUES
          (@id, @uri, @scopeKey, @workspaceId, @accountId, @userId, @worldId, @granularity, @digestKey,
           @sessionId, @periodStart, @periodEnd, @periodStartMs, @periodEndMs, @timeZone, @status,
           '', '', '[]', '[]', '', 0, @now, @now)
         ON CONFLICT(scope_key, granularity, digest_key) DO NOTHING`,
      )
      .run({
        id,
        uri,
        scopeKey: input.scope.key,
        workspaceId: input.scope.workspaceId,
        accountId: input.scope.accountId,
        userId: input.scope.userId,
        worldId: input.scope.worldId,
        granularity: input.granularity,
        digestKey: requireText(input.digestKey, "digest key"),
        sessionId: input.sessionId?.trim() ?? "",
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        periodStartMs: startMs,
        periodEndMs: endMs,
        timeZone: requireText(input.timeZone, "digest time zone"),
        status: input.status,
        now: input.now,
      });
    return this.requireDigestByIdentity(input.scope.key, input.granularity, input.digestKey);
  }

  digestByUri(uri: string): AgentTemporalMemoryDigest | undefined {
    const row = this.db.prepare<[string], DigestRow>("SELECT * FROM memory_temporal_digests WHERE uri = ?").get(uri);
    return row ? decodeDigest(row) : undefined;
  }

  digestById(id: string): AgentTemporalMemoryDigest | undefined {
    const row = this.db.prepare<[string], DigestRow>("SELECT * FROM memory_temporal_digests WHERE id = ?").get(id);
    return row ? decodeDigest(row) : undefined;
  }

  digestByKey(
    scopeKey: string,
    granularity: AgentTemporalMemoryGranularity,
    digestKey: string,
  ): AgentTemporalMemoryDigest | undefined {
    const row = this.db
      .prepare<[string, AgentTemporalMemoryGranularity, string], DigestRow>(
        "SELECT * FROM memory_temporal_digests WHERE scope_key = ? AND granularity = ? AND digest_key = ?",
      )
      .get(scopeKey, granularity, digestKey);
    return row ? decodeDigest(row) : undefined;
  }

  digestsByUris(uris: readonly string[]): AgentTemporalMemoryDigest[] {
    return uniqueText(uris).flatMap((uri) => {
      const digest = this.digestByUri(uri);
      return digest ? [digest] : [];
    });
  }

  openSegment(scopeKey: string, sessionId: string): AgentTemporalMemoryDigest | undefined {
    const row = this.db
      .prepare<[string, string], DigestRow>(
        `SELECT * FROM memory_temporal_digests
          WHERE scope_key = ? AND granularity = 'segment' AND session_id = ? AND status = 'open'
          ORDER BY period_end_ms DESC, id DESC LIMIT 1`,
      )
      .get(scopeKey, sessionId);
    return row ? decodeDigest(row) : undefined;
  }

  segmentForEpisode(episodeUri: string): AgentTemporalMemoryDigest | undefined {
    const row = this.db
      .prepare<[string], DigestRow>(
        `SELECT d.* FROM memory_temporal_digests d
           JOIN memory_temporal_digest_members m ON m.digest_id = d.id
          WHERE m.member_uri = ? AND m.member_kind = 'episode' AND d.granularity = 'segment'
          LIMIT 1`,
      )
      .get(episodeUri);
    return row ? decodeDigest(row) : undefined;
  }

  replaceMembers(
    digestId: string,
    members: readonly AgentTemporalMemoryMemberInput[],
    input: {
      readonly periodStart: string;
      readonly periodEnd: string;
      readonly status: AgentTemporalMemoryDigestStatus;
      readonly now: string;
    },
  ): AgentTemporalMemoryDigest {
    const normalized = normalizeMembers(members);
    if (normalized.length === 0) throw new Error("Temporal digest must contain at least one member.");
    const periodStartMs = parseInstantMs(input.periodStart, "digest member period start");
    const periodEndMs = parseInstantMs(input.periodEnd, "digest member period end");
    const revision = memberRevision(normalized);
    const replace = this.db.transaction(() => {
      this.requireDigest(digestId);
      this.db.prepare<[string]>("DELETE FROM memory_temporal_digest_members WHERE digest_id = ?").run(digestId);
      const insert = this.db.prepare(
        `INSERT INTO memory_temporal_digest_members
          (digest_id, member_uri, member_kind, ordinal, occurred_at, source_revision)
         VALUES (@digestId, @memberUri, @memberKind, @ordinal, @occurredAt, @sourceRevision)`,
      );
      normalized.forEach((member, ordinal) => insert.run({ digestId, ordinal, ...member }));
      this.db
        .prepare(
          `UPDATE memory_temporal_digests
              SET period_start = @periodStart, period_end = @periodEnd,
                  period_start_ms = @periodStartMs, period_end_ms = @periodEndMs,
                  status = @status, summary = '', topics_json = '[]', open_loops_json = '[]',
                  summary_parts_json = '[]', topics_parts_json = '[]', open_loops_parts_json = '[]',
                  source_revision = @revision, child_count = @childCount, updated_at = @now
            WHERE id = @digestId`,
        )
        .run({
          digestId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          periodStartMs,
          periodEndMs,
          status: input.status,
          revision,
          childCount: normalized.length,
          now: input.now,
        });
      return this.requireDigest(digestId);
    });
    return replace();
  }

  members(digestId: string): AgentTemporalMemoryDigestMember[] {
    return this.db
      .prepare<[string], MemberRow>(
        "SELECT * FROM memory_temporal_digest_members WHERE digest_id = ? ORDER BY ordinal, member_uri",
      )
      .all(digestId)
      .map(decodeMember);
  }

  enqueueSegmentDecision(input: {
    readonly episodeUri: string;
    readonly scopeKey: string;
    readonly sessionId: string;
    readonly sourceRevision: string;
    readonly completedAtMs: number;
    readonly now: string;
    readonly nowMs: number;
  }): AgentConversationSegmentDecision {
    this.db
      .prepare(
        `INSERT INTO memory_temporal_segment_decisions
          (episode_uri, scope_key, session_id, source_revision, completed_at_ms, status, relation, confidence,
           predecessor_digest_uri, assigned_digest_uri, next_attempt_at_ms, attempt_count, last_error,
           created_at, updated_at)
         VALUES (@episodeUri, @scopeKey, @sessionId, @sourceRevision, @completedAtMs, 'pending', NULL, NULL,
                 NULL, NULL, @nowMs, 0, NULL, @now, @now)
         ON CONFLICT(episode_uri) DO UPDATE SET
           scope_key = excluded.scope_key,
           session_id = excluded.session_id,
           source_revision = excluded.source_revision,
           completed_at_ms = excluded.completed_at_ms,
           status = CASE
             WHEN memory_temporal_segment_decisions.source_revision = excluded.source_revision
               THEN memory_temporal_segment_decisions.status
             ELSE 'pending'
           END,
           relation = CASE
             WHEN memory_temporal_segment_decisions.source_revision = excluded.source_revision
               THEN memory_temporal_segment_decisions.relation
             ELSE NULL
           END,
           confidence = CASE
             WHEN memory_temporal_segment_decisions.source_revision = excluded.source_revision
               THEN memory_temporal_segment_decisions.confidence
             ELSE NULL
           END,
           predecessor_digest_uri = CASE
             WHEN memory_temporal_segment_decisions.source_revision = excluded.source_revision
               THEN memory_temporal_segment_decisions.predecessor_digest_uri
             ELSE NULL
           END,
           assigned_digest_uri = CASE
             WHEN memory_temporal_segment_decisions.source_revision = excluded.source_revision
               THEN memory_temporal_segment_decisions.assigned_digest_uri
             ELSE NULL
           END,
           next_attempt_at_ms = CASE
             WHEN memory_temporal_segment_decisions.source_revision = excluded.source_revision
               THEN memory_temporal_segment_decisions.next_attempt_at_ms
             ELSE excluded.next_attempt_at_ms
           END,
           attempt_count = CASE
             WHEN memory_temporal_segment_decisions.source_revision = excluded.source_revision
               THEN memory_temporal_segment_decisions.attempt_count
             ELSE 0
           END,
           last_error = CASE
             WHEN memory_temporal_segment_decisions.source_revision = excluded.source_revision
               THEN memory_temporal_segment_decisions.last_error
             ELSE NULL
           END,
           updated_at = excluded.updated_at`,
      )
      .run(input);
    return this.requireSegmentDecision(input.episodeUri);
  }

  dueSegmentDecisions(scopeKey: string, nowMs: number, limit: number): AgentConversationSegmentDecision[] {
    return this.db
      .prepare<[string, number, number], SegmentDecisionRow>(
        `SELECT candidate.* FROM memory_temporal_segment_decisions candidate
          WHERE candidate.scope_key = ? AND candidate.status = 'pending' AND candidate.next_attempt_at_ms <= ?
            AND NOT EXISTS (
              SELECT 1 FROM memory_temporal_segment_decisions predecessor
               WHERE predecessor.scope_key = candidate.scope_key
                 AND predecessor.session_id = candidate.session_id
                 AND predecessor.status <> 'resolved'
                 AND (
                   predecessor.completed_at_ms < candidate.completed_at_ms OR
                   (predecessor.completed_at_ms = candidate.completed_at_ms AND predecessor.episode_uri < candidate.episode_uri)
                 )
            )
          ORDER BY candidate.completed_at_ms, candidate.episode_uri LIMIT ?`,
      )
      .all(scopeKey, nowMs, limit)
      .map(decodeSegmentDecision);
  }

  nextSegmentDecisionAt(scopeKey: string): number | undefined {
    return this.db
      .prepare<[string], { readonly next_attempt_at_ms: number }>(
        `SELECT candidate.next_attempt_at_ms FROM memory_temporal_segment_decisions candidate
          WHERE candidate.scope_key = ? AND candidate.status = 'pending'
            AND NOT EXISTS (
              SELECT 1 FROM memory_temporal_segment_decisions predecessor
               WHERE predecessor.scope_key = candidate.scope_key
                 AND predecessor.session_id = candidate.session_id
                 AND predecessor.status <> 'resolved'
                 AND (
                   predecessor.completed_at_ms < candidate.completed_at_ms OR
                   (predecessor.completed_at_ms = candidate.completed_at_ms AND predecessor.episode_uri < candidate.episode_uri)
                 )
            )
          ORDER BY candidate.next_attempt_at_ms, candidate.completed_at_ms, candidate.episode_uri LIMIT 1`,
      )
      .get(scopeKey)?.next_attempt_at_ms;
  }

  resolveSegmentDecision(input: {
    readonly episodeUri: string;
    readonly relation: AgentConversationSegmentDecisionRelation;
    readonly confidence: number;
    readonly predecessorDigestUri: string | null;
    readonly assignedDigestUri: string;
    readonly now: string;
  }): void {
    if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
      throw new Error("Conversation segment decision confidence must be between zero and one.");
    }
    const result = this.db
      .prepare(
        `UPDATE memory_temporal_segment_decisions
            SET status = 'resolved', relation = @relation, confidence = @confidence,
                predecessor_digest_uri = @predecessorDigestUri, assigned_digest_uri = @assignedDigestUri,
                last_error = NULL, updated_at = @now
          WHERE episode_uri = @episodeUri`,
      )
      .run(input);
    if (result.changes !== 1) throw new Error(`Conversation segment decision does not exist: ${input.episodeUri}`);
  }

  retrySegmentDecision(input: {
    readonly episodeUri: string;
    readonly attemptCount: number;
    readonly nextAttemptAtMs: number;
    readonly error: string;
    readonly now: string;
  }): void {
    this.db
      .prepare(
        `UPDATE memory_temporal_segment_decisions
            SET status = 'pending', attempt_count = @attemptCount, next_attempt_at_ms = @nextAttemptAtMs,
                last_error = @error, updated_at = @now
          WHERE episode_uri = @episodeUri`,
      )
      .run({ ...input, error: requireText(input.error, "conversation segment decision error") });
  }

  failSegmentDecision(episodeUri: string, attemptCount: number, error: string, now: string): void {
    this.db
      .prepare(
        `UPDATE memory_temporal_segment_decisions
            SET status = 'failed', attempt_count = ?, last_error = ?, updated_at = ?
          WHERE episode_uri = ?`,
      )
      .run(attemptCount, requireText(error, "conversation segment decision failure"), now, episodeUri);
  }

  schedule(digestId: string, nextAttemptAtMs: number, now: string): void {
    if (!Number.isSafeInteger(nextAttemptAtMs)) throw new Error("Temporal digest job time must be a safe integer.");
    this.requireDigest(digestId);
    this.db
      .prepare(
        `INSERT INTO memory_temporal_digest_jobs
          (digest_id, next_attempt_at_ms, attempt_count, last_error, updated_at)
         VALUES (?, ?, 0, NULL, ?)
         ON CONFLICT(digest_id) DO UPDATE SET
           next_attempt_at_ms = excluded.next_attempt_at_ms,
           attempt_count = 0,
           last_error = NULL,
           updated_at = excluded.updated_at`,
      )
      .run(digestId, nextAttemptAtMs, now);
  }

  dueJobs(nowMs: number, limit: number): AgentTemporalMemoryDigestJob[] {
    return this.db
      .prepare<[number, number], JobRow>(
        `SELECT j.* FROM memory_temporal_digest_jobs j
           JOIN memory_temporal_digests d ON d.id = j.digest_id
          WHERE j.next_attempt_at_ms <= ? AND d.status <> 'failed'
          ORDER BY j.next_attempt_at_ms, j.digest_id LIMIT ?`,
      )
      .all(nowMs, limit)
      .map(decodeJob);
  }

  nextJobAt(): number | undefined {
    const row = this.db
      .prepare<[], { readonly next_attempt_at_ms: number }>(
        `SELECT j.next_attempt_at_ms FROM memory_temporal_digest_jobs j
           JOIN memory_temporal_digests d ON d.id = j.digest_id
          WHERE d.status <> 'failed' ORDER BY j.next_attempt_at_ms LIMIT 1`,
      )
      .get();
    return row?.next_attempt_at_ms;
  }

  setWorkingFocus(digestId: string, focus: string, now: string): AgentTemporalMemoryDigest {
    const result = this.db
      .prepare(
        `UPDATE memory_temporal_digests
            SET working_focus = ?, updated_at = ?
          WHERE id = ? AND granularity = 'segment' AND status = 'open'`,
      )
      .run(requireText(focus, "conversation segment working focus"), now, digestId);
    if (result.changes !== 1) throw new Error(`Open conversation segment does not exist: ${digestId}`);
    return this.requireDigest(digestId);
  }

  seal(digestId: string, summary: AgentTemporalMemorySummaryResult, now: string): AgentTemporalMemoryDigest {
    const summaryParts = normalizeAgentTextValue(summary.summary, "temporal digest summary");
    const topicParts = summary.topics.map((topic) => normalizeAgentTextValue(topic, "temporal digest topic"));
    const openLoopParts = summary.openLoops.map((loop) => normalizeAgentTextValue(loop, "temporal digest open loop"));
    const topicText = uniqueText(topicParts.map((parts) => renderAgentTextParts(parts)));
    const openLoopText = uniqueText(openLoopParts.map((parts) => renderAgentTextParts(parts)));
    const seal = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE memory_temporal_digests
              SET status = 'sealed', working_focus = '', summary = ?, topics_json = ?, open_loops_json = ?,
                  summary_parts_json = ?, topics_parts_json = ?, open_loops_parts_json = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(
          renderAgentTextParts(summaryParts),
          JSON.stringify(topicText),
          JSON.stringify(openLoopText),
          JSON.stringify(summaryParts),
          JSON.stringify(topicParts),
          JSON.stringify(openLoopParts),
          now,
          digestId,
        );
      this.db.prepare<[string]>("DELETE FROM memory_temporal_digest_jobs WHERE digest_id = ?").run(digestId);
      return this.requireDigest(digestId);
    });
    return seal();
  }

  retry(digestId: string, attemptCount: number, nextAttemptAtMs: number, error: string, now: string): void {
    this.db
      .prepare(
        `UPDATE memory_temporal_digest_jobs
            SET attempt_count = ?, next_attempt_at_ms = ?, last_error = ?, updated_at = ?
          WHERE digest_id = ?`,
      )
      .run(attemptCount, nextAttemptAtMs, requireText(error, "temporal digest error"), now, digestId);
    this.db
      .prepare("UPDATE memory_temporal_digests SET status = 'pending', updated_at = ? WHERE id = ?")
      .run(now, digestId);
  }

  fail(digestId: string, error: string, now: string): void {
    const fail = this.db.transaction(() => {
      this.db
        .prepare("UPDATE memory_temporal_digests SET status = 'failed', updated_at = ? WHERE id = ?")
        .run(now, digestId);
      this.db
        .prepare("UPDATE memory_temporal_digest_jobs SET last_error = ?, updated_at = ? WHERE digest_id = ?")
        .run(requireText(error, "temporal digest failure"), now, digestId);
    });
    fail();
  }

  list(
    scopeKey: string,
    input: {
      readonly granularities?: readonly AgentTemporalMemoryGranularity[];
      readonly statuses?: readonly AgentTemporalMemoryDigestStatus[];
      readonly startMs?: number;
      readonly endMs?: number;
    } = {},
  ): AgentTemporalMemoryDigest[] {
    const clauses = ["scope_key = @scopeKey"];
    const bindings: Record<string, unknown> = { scopeKey };
    if (input.startMs !== undefined) {
      clauses.push("period_end_ms > @startMs");
      bindings.startMs = input.startMs;
    }
    if (input.endMs !== undefined) {
      clauses.push("period_start_ms < @endMs");
      bindings.endMs = input.endMs;
    }
    appendInClause(clauses, bindings, "granularity", input.granularities);
    appendInClause(clauses, bindings, "status", input.statuses);
    return this.db
      .prepare<Record<string, unknown>, DigestRow>(
        `SELECT * FROM memory_temporal_digests WHERE ${clauses.join(" AND ")}
         ORDER BY period_start_ms, period_end_ms, granularity, id`,
      )
      .all(bindings)
      .map(decodeDigest);
  }

  overview(scopeKey: string): AgentTemporalMemoryOverview {
    const counts = this.db
      .prepare<
        [string],
        {
          readonly granularity: AgentTemporalMemoryGranularity;
          readonly status: AgentTemporalMemoryDigestStatus;
          readonly count: number;
        }
      >(
        `SELECT granularity, status, COUNT(*) AS count
           FROM memory_temporal_digests
          WHERE scope_key = ?
          GROUP BY granularity, status
          ORDER BY granularity, status`,
      )
      .all(scopeKey);
    const latestSealed = this.db
      .prepare<[string], DigestRow>(
        `SELECT current.*
           FROM memory_temporal_digests current
          WHERE current.scope_key = ? AND current.status = 'sealed'
            AND NOT EXISTS (
              SELECT 1 FROM memory_temporal_digests newer
               WHERE newer.scope_key = current.scope_key
                 AND newer.granularity = current.granularity
                 AND newer.status = 'sealed'
                 AND (
                   newer.period_end_ms > current.period_end_ms OR
                   (newer.period_end_ms = current.period_end_ms AND newer.updated_at > current.updated_at) OR
                   (newer.period_end_ms = current.period_end_ms AND newer.updated_at = current.updated_at AND newer.id > current.id)
                 )
            )
          ORDER BY current.period_end_ms DESC, current.granularity`,
      )
      .all(scopeKey)
      .map(decodeDigest);
    const segmentDecisions = this.db
      .prepare<[string], { readonly status: AgentConversationSegmentDecision["status"]; readonly count: number }>(
        `SELECT status, COUNT(*) AS count
           FROM memory_temporal_segment_decisions
          WHERE scope_key = ?
          GROUP BY status
          ORDER BY status`,
      )
      .all(scopeKey);
    return { counts, segmentDecisions, latestSealed };
  }

  deleteAncestors(memberUri: string): number {
    const ids = this.collectAncestorIds([memberUri]);
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => "?").join(", ");
    return this.db.prepare(`DELETE FROM memory_temporal_digests WHERE id IN (${placeholders})`).run(...ids).changes;
  }

  invalidateEpisodes(episodeUris: readonly string[], now: string): number {
    const normalized = uniqueText(episodeUris);
    if (normalized.length === 0) return 0;
    const affected = normalized.flatMap((uri) => {
      const digest = this.segmentForEpisode(uri);
      return digest ? [{ digest, uri }] : [];
    });
    const segmentIds = new Set(affected.map((entry) => entry.digest.id));
    const ancestorIds = this.collectAncestorIds(affected.map((entry) => entry.digest.uri));
    const invalidate = this.db.transaction(() => {
      let changes = 0;
      if (ancestorIds.length > 0) {
        const placeholders = ancestorIds.map(() => "?").join(", ");
        changes += this.db
          .prepare(`DELETE FROM memory_temporal_digests WHERE id IN (${placeholders})`)
          .run(...ancestorIds).changes;
      }
      const deleteMember = this.db.prepare(
        "DELETE FROM memory_temporal_digest_members WHERE digest_id = ? AND member_uri = ?",
      );
      for (const entry of affected) changes += deleteMember.run(entry.digest.id, entry.uri).changes;
      for (const digestId of segmentIds) {
        const members = this.members(digestId);
        if (members.length === 0) {
          changes += this.db.prepare("DELETE FROM memory_temporal_digests WHERE id = ?").run(digestId).changes;
          continue;
        }
        const first = members[0]!;
        const last = members.at(-1)!;
        this.db
          .prepare(
            `UPDATE memory_temporal_digests
                SET period_start = ?, period_end = ?, period_start_ms = ?, period_end_ms = ?,
                    status = 'pending', summary = '', topics_json = '[]', open_loops_json = '[]',
                    summary_parts_json = '[]', topics_parts_json = '[]', open_loops_parts_json = '[]',
                    source_revision = ?, child_count = ?, updated_at = ?
              WHERE id = ?`,
          )
          .run(
            first.occurredAt,
            last.occurredAt,
            parseInstantMs(first.occurredAt, "remaining segment start"),
            parseInstantMs(last.occurredAt, "remaining segment end"),
            memberRevision(members),
            members.length,
            now,
            digestId,
          );
        this.schedule(digestId, Date.parse(now), now);
      }
      return changes;
    });
    return invalidate();
  }

  deleteSession(sessionId: string): void {
    const segments = this.db
      .prepare<[string], DigestRow>(
        "SELECT * FROM memory_temporal_digests WHERE granularity = 'segment' AND session_id = ?",
      )
      .all(sessionId)
      .map(decodeDigest);
    const ancestors = this.collectAncestorIds(segments.map((digest) => digest.uri));
    const ids = uniqueText([...segments.map((digest) => digest.id), ...ancestors]);
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(", ");
    this.db.prepare(`DELETE FROM memory_temporal_digests WHERE id IN (${placeholders})`).run(...ids);
  }

  private collectAncestorIds(memberUris: readonly string[]): string[] {
    const pending = uniqueText(memberUris);
    const visitedUris = new Set(pending);
    const ids = new Set<string>();
    const select = this.db.prepare<[string], DigestRow>(
      `SELECT d.* FROM memory_temporal_digests d
         JOIN memory_temporal_digest_members m ON m.digest_id = d.id
        WHERE m.member_uri = ?`,
    );
    while (pending.length > 0) {
      const memberUri = pending.shift()!;
      for (const row of select.all(memberUri)) {
        if (ids.has(row.id)) continue;
        ids.add(row.id);
        if (!visitedUris.has(row.uri)) {
          visitedUris.add(row.uri);
          pending.push(row.uri);
        }
      }
    }
    return [...ids];
  }

  private requireDigestByIdentity(
    scopeKey: string,
    granularity: AgentTemporalMemoryGranularity,
    digestKey: string,
  ): AgentTemporalMemoryDigest {
    const row = this.db
      .prepare<[string, AgentTemporalMemoryGranularity, string], DigestRow>(
        "SELECT * FROM memory_temporal_digests WHERE scope_key = ? AND granularity = ? AND digest_key = ?",
      )
      .get(scopeKey, granularity, digestKey);
    if (!row) throw new Error(`Temporal digest was not persisted: ${granularity}:${digestKey}`);
    return decodeDigest(row);
  }

  private requireSegmentDecision(episodeUri: string): AgentConversationSegmentDecision {
    const row = this.db
      .prepare<[string], SegmentDecisionRow>("SELECT * FROM memory_temporal_segment_decisions WHERE episode_uri = ?")
      .get(episodeUri);
    if (!row) throw new Error(`Conversation segment decision was not persisted: ${episodeUri}`);
    return decodeSegmentDecision(row);
  }

  private requireDigest(id: string): AgentTemporalMemoryDigest {
    const digest = this.digestById(id);
    if (!digest) throw new Error(`Temporal digest does not exist: ${id}`);
    return digest;
  }
}

function decodeDigest(row: DigestRow): AgentTemporalMemoryDigest {
  const summaryParts = readStoredParts(row.summary_parts_json, row.summary, `${row.uri} summary`);
  const topicParts = readStoredPartArray(row.topics_parts_json, row.topics_json, `${row.uri} topics`);
  const openLoopParts = readStoredPartArray(row.open_loops_parts_json, row.open_loops_json, `${row.uri} open loops`);
  return {
    id: row.id,
    uri: row.uri,
    scope: {
      key: row.scope_key,
      workspaceId: row.workspace_id,
      accountId: row.account_id,
      userId: row.user_id,
      worldId: row.world_id,
    },
    granularity: row.granularity,
    digestKey: row.digest_key,
    sessionId: row.session_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    periodStartMs: row.period_start_ms,
    periodEndMs: row.period_end_ms,
    timeZone: row.time_zone,
    status: row.status,
    workingFocus: row.working_focus,
    summary: renderAgentTextParts(summaryParts),
    topics: uniqueText(topicParts.map((parts) => renderAgentTextParts(parts))),
    openLoops: uniqueText(openLoopParts.map((parts) => renderAgentTextParts(parts))),
    summaryParts,
    topicParts,
    openLoopParts,
    sourceRevision: row.source_revision,
    childCount: row.child_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function decodeMember(row: MemberRow): AgentTemporalMemoryDigestMember {
  return {
    digestId: row.digest_id,
    memberUri: row.member_uri,
    memberKind: row.member_kind,
    ordinal: row.ordinal,
    occurredAt: row.occurred_at,
    sourceRevision: row.source_revision,
  };
}

function decodeJob(row: JobRow): AgentTemporalMemoryDigestJob {
  return {
    digestId: row.digest_id,
    nextAttemptAtMs: row.next_attempt_at_ms,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

function decodeSegmentDecision(row: SegmentDecisionRow): AgentConversationSegmentDecision {
  return {
    episodeUri: row.episode_uri,
    scopeKey: row.scope_key,
    sessionId: row.session_id,
    sourceRevision: row.source_revision,
    completedAtMs: row.completed_at_ms,
    status: row.status,
    relation: row.relation,
    confidence: row.confidence,
    predecessorDigestUri: row.predecessor_digest_uri,
    assignedDigestUri: row.assigned_digest_uri,
    nextAttemptAtMs: row.next_attempt_at_ms,
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeMembers(members: readonly AgentTemporalMemoryMemberInput[]): AgentTemporalMemoryMemberInput[] {
  const unique = new Map<string, AgentTemporalMemoryMemberInput>();
  for (const member of members) {
    const normalized = {
      memberUri: requireText(member.memberUri, "temporal digest member URI"),
      memberKind: member.memberKind,
      occurredAt: new Date(parseInstantMs(member.occurredAt, "temporal digest member time")).toISOString(),
      sourceRevision: requireText(member.sourceRevision, "temporal digest member revision"),
    };
    unique.set(normalized.memberUri, normalized);
  }
  return [...unique.values()].sort(
    (left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.memberUri.localeCompare(right.memberUri),
  );
}

function memberRevision(
  members: readonly AgentTemporalMemoryMemberInput[] | readonly AgentTemporalMemoryDigestMember[],
): string {
  const hash = crypto.createHash("sha256");
  for (const member of members) {
    hash.update(member.memberUri);
    hash.update("\0");
    hash.update(member.sourceRevision);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function parseTextArray(value: string, label: string): string[] {
  const parsed = parseJsonText(value, label);
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error(`${label} must contain a string array.`);
  }
  return uniqueText(parsed);
}

function readStoredParts(value: string, legacyValue: string, label: string): AgentTextParts {
  const parsed = parseAgentTextParts(parseJsonText(value, `${label} parts`), `${label} parts`);
  return parsed.length > 0 ? parsed : projectLegacyIdentityText(legacyValue);
}

function readStoredPartArray(value: string, legacyValue: string, label: string): AgentTextParts[] {
  const parsed = parseJsonText(value, `${label} parts`);
  if (!Array.isArray(parsed)) throw new Error(`${label} parts must contain an array.`);
  if (parsed.length === 0) return parseTextArray(legacyValue, label).map((entry) => projectLegacyIdentityText(entry));
  return parsed.map((entry, index) => parseAgentTextParts(entry, `${label} parts[${index}]`));
}

function appendInClause(
  clauses: string[],
  bindings: Record<string, unknown>,
  column: string,
  values: readonly string[] | undefined,
): void {
  const normalized = uniqueText(values ?? []);
  if (normalized.length === 0) return;
  const names = normalized.map((value, index) => {
    const name = `${column}${index}`;
    bindings[name] = value;
    return `@${name}`;
  });
  clauses.push(`${column} IN (${names.join(", ")})`);
}

function parseInstantMs(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be an RFC 3339 timestamp.`);
  return parsed;
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be empty.`);
  return normalized;
}

function uniqueText(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
