import type Database from "better-sqlite3";
import { Temporal } from "@js-temporal/polyfill";
import { createOpaqueId } from "../Core/AgentIds.js";
import { stringifyAgentCanonicalJson } from "../Core/AgentCanonicalJson.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { parseJsonText } from "../Core/AgentJsonParsing.js";
import { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";

export const AgentWorldWorkStatuses = Object.freeze({
  Pending: "pending",
  Leased: "leased",
  Running: "running",
  Acknowledged: "acknowledged",
  Failed: "failed",
  Unknown: "unknown",
  Cancelled: "cancelled",
  ReconciliationRequired: "reconciliation_required",
} as const);

export type AgentWorldWorkStatus = (typeof AgentWorldWorkStatuses)[keyof typeof AgentWorldWorkStatuses];

export interface AgentWorldWorkItem {
  readonly id: string;
  readonly worldId: string;
  readonly sourceId: string;
  readonly candidateId: string;
  readonly requestId: string;
  readonly payloadHash: string;
  readonly payload: unknown;
  readonly status: AgentWorldWorkStatus;
  readonly leaseOwner?: string;
  readonly leaseGeneration: number;
  readonly leaseUntil?: string;
  readonly attemptCount: number;
  readonly nextAttemptAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly result?: unknown;
  readonly evidenceRefs: readonly string[];
  readonly lastError?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentWorldWorkLease {
  readonly item: AgentWorldWorkItem;
  readonly owner: string;
  readonly generation: number;
  readonly leaseUntil: string;
}

interface WorkItemRow {
  readonly id: string;
  readonly world_id: string;
  readonly source_id: string;
  readonly candidate_id: string;
  readonly request_id: string;
  readonly payload_hash: string;
  readonly payload_json: string;
  readonly status: string;
  readonly lease_owner: string | null;
  readonly lease_generation: number;
  readonly lease_until: string | null;
  readonly attempt_count: number;
  readonly next_attempt_at: string;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly result_json: string | null;
  readonly evidence_refs_json: string;
  readonly last_error: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface AgentWorldWorkEnqueueInput {
  readonly id?: string;
  readonly worldId: string;
  readonly sourceId: string;
  readonly candidateId: string;
  readonly requestId: string;
  readonly payload: unknown;
  readonly payloadHash?: string;
  readonly nextAttemptAt: string | Temporal.Instant;
  readonly now: string | Temporal.Instant;
}

export interface AgentWorldWorkClaimInput {
  readonly id: string;
  readonly owner: string;
  readonly now: string | Temporal.Instant;
  readonly leaseUntil: string | Temporal.Instant;
}

export interface AgentWorldWorkMutationInput {
  readonly id: string;
  readonly owner: string;
  readonly generation: number;
  readonly now: string | Temporal.Instant;
}

export interface AgentWorldWorkAckInput extends AgentWorldWorkMutationInput {
  readonly result?: unknown;
  readonly evidenceRefs: readonly string[];
}

export interface AgentWorldWorkFailInput extends AgentWorldWorkMutationInput {
  readonly error: string;
  readonly nextAttemptAt: string | Temporal.Instant;
}

export interface AgentWorldWorkRecoveryResult {
  readonly releasedLeases: number;
  readonly reconciliationRequired: number;
}

/** Durable, fenced work queue for world sources that may cross a process restart. */
export class AgentWorldWorkLedger {
  private readonly db: Database.Database;

  constructor(database: AgentSqliteDatabaseKernel | Database.Database) {
    this.db = database instanceof AgentSqliteDatabaseKernel ? database.connection : database;
  }

  enqueue(input: AgentWorldWorkEnqueueInput): AgentWorldWorkItem {
    const worldId = requireText(input.worldId, "World work item world id");
    const sourceId = requireText(input.sourceId, "World work item source id");
    const candidateId = requireText(input.candidateId, "World work item candidate id");
    const requestId = requireText(input.requestId, "World work item request id");
    const payloadJson = stringifyAgentCanonicalJson(input.payload);
    const payloadHash = input.payloadHash
      ? requireText(input.payloadHash, "World work item payload hash")
      : sha256HexOfCanonicalJson(input.payload);
    if (payloadHash !== sha256HexOfCanonicalJson(input.payload)) {
      throw new Error(`World work item payload hash does not match its payload: ${candidateId}.`);
    }
    const now = normalizeInstant(input.now, "World work item creation time");
    const nextAttemptAt = normalizeInstant(input.nextAttemptAt, "World work item next attempt time");
    const id = input.id === undefined ? createOpaqueId("world_work") : requireText(input.id, "World work item id");
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO agent_world_work_items (
             id, world_id, source_id, candidate_id, request_id, payload_hash, payload_json, status,
             lease_owner, lease_generation, lease_until, attempt_count, next_attempt_at, started_at,
             completed_at, result_json, evidence_refs_json, last_error, created_at, updated_at
           ) VALUES (
             @id, @worldId, @sourceId, @candidateId, @requestId, @payloadHash, @payloadJson, 'pending',
             NULL, 0, NULL, 0, @nextAttemptAt, NULL, NULL, NULL, '[]', NULL, @now, @now
           ) ON CONFLICT DO NOTHING`,
        )
        .run({ id, worldId, sourceId, candidateId, requestId, payloadHash, payloadJson, nextAttemptAt, now });

      const existing = this.findByCandidate(worldId, sourceId, candidateId) ?? this.findByRequest(requestId);
      if (!existing) throw new Error(`World work item was not persisted: ${candidateId}.`);
      assertEnqueueIdentity(existing, { worldId, sourceId, candidateId, requestId, payloadHash });
      return existing;
    });
    return transaction();
  }

  claim(input: AgentWorldWorkClaimInput): AgentWorldWorkLease | undefined {
    const id = requireText(input.id, "World work item id");
    const owner = requireText(input.owner, "World work lease owner");
    const now = normalizeInstant(input.now, "World work claim time");
    const leaseUntil = normalizeInstant(input.leaseUntil, "World work lease expiry");
    assertFutureLease(now, leaseUntil);
    const transaction = this.db.transaction(() => {
      const update = this.db
        .prepare(
          `UPDATE agent_world_work_items
           SET status = 'leased', lease_owner = @owner, lease_generation = lease_generation + 1,
               lease_until = @leaseUntil, attempt_count = attempt_count + 1, updated_at = @now
           WHERE id = @id
             AND ((status IN ('pending', 'failed') AND next_attempt_at <= @now)
               OR (status = 'leased' AND lease_until <= @now))`,
        )
        .run({ id, owner, leaseUntil, now });
      if (update.changes === 0) return undefined;
      const row = this.findRow(id);
      if (!row) throw new Error(`Claimed world work item disappeared: ${id}.`);
      return toLease(row, owner);
    });
    return transaction();
  }

  markRunning(input: AgentWorldWorkMutationInput): AgentWorldWorkLease {
    this.requireCurrentLease(input, [AgentWorldWorkStatuses.Leased]);
    const now = normalizeInstant(input.now, "World work start time");
    const update = this.db
      .prepare(
        `UPDATE agent_world_work_items
         SET status = 'running', started_at = COALESCE(started_at, @now), updated_at = @now
         WHERE id = @id AND status = 'leased' AND lease_owner = @owner
           AND lease_generation = @generation AND lease_until > @now`,
      )
      .run({ id: input.id, owner: input.owner, generation: input.generation, now });
    if (update.changes !== 1) throw staleLeaseError(input.id, input.owner, input.generation);
    const row = this.findRow(input.id);
    if (!row) throw new Error(`Running world work item disappeared: ${input.id}.`);
    return toLease(row, input.owner);
  }

  renew(input: AgentWorldWorkMutationInput & { readonly leaseUntil: string | Temporal.Instant }): AgentWorldWorkLease {
    const now = normalizeInstant(input.now, "World work renewal time");
    const leaseUntil = normalizeInstant(input.leaseUntil, "World work lease expiry");
    assertFutureLease(now, leaseUntil);
    const update = this.db
      .prepare(
        `UPDATE agent_world_work_items
         SET lease_until = @leaseUntil, updated_at = @now
         WHERE id = @id AND status IN ('leased', 'running') AND lease_owner = @owner
           AND lease_generation = @generation AND lease_until > @now`,
      )
      .run({ id: input.id, owner: input.owner, generation: input.generation, leaseUntil, now });
    if (update.changes !== 1) throw staleLeaseError(input.id, input.owner, input.generation);
    const row = this.findRow(input.id);
    if (!row) throw new Error(`Renewed world work item disappeared: ${input.id}.`);
    return toLease(row, input.owner);
  }

  ack(input: AgentWorldWorkAckInput): AgentWorldWorkItem {
    const now = normalizeInstant(input.now, "World work acknowledgement time");
    const evidenceRefs = normalizeEvidenceRefs(input.evidenceRefs);
    const resultJson = input.result === undefined ? null : stringifyAgentCanonicalJson(input.result);
    const update = this.db
      .prepare(
        `UPDATE agent_world_work_items
         SET status = 'acknowledged', lease_owner = NULL, lease_until = NULL,
             completed_at = @now, result_json = @resultJson, evidence_refs_json = @evidenceRefsJson,
             last_error = NULL, updated_at = @now
         WHERE id = @id AND status IN ('leased', 'running') AND lease_owner = @owner
           AND lease_generation = @generation AND lease_until > @now`,
      )
      .run({
        id: input.id,
        owner: input.owner,
        generation: input.generation,
        now,
        resultJson,
        evidenceRefsJson: JSON.stringify(evidenceRefs),
      });
    if (update.changes === 0) {
      const existing = this.get(input.id);
      if (existing?.status === AgentWorldWorkStatuses.Acknowledged) return existing;
      throw staleLeaseError(input.id, input.owner, input.generation);
    }
    return this.requireItem(input.id);
  }

  fail(input: AgentWorldWorkFailInput): AgentWorldWorkItem {
    const now = normalizeInstant(input.now, "World work failure time");
    const nextAttemptAt = normalizeInstant(input.nextAttemptAt, "World work next attempt time");
    const error = requireText(input.error, "World work failure reason");
    const update = this.db
      .prepare(
        `UPDATE agent_world_work_items
         SET status = 'failed', lease_owner = NULL, lease_until = NULL, next_attempt_at = @nextAttemptAt,
             last_error = @error, updated_at = @now
         WHERE id = @id AND status IN ('leased', 'running') AND lease_owner = @owner
           AND lease_generation = @generation AND lease_until > @now`,
      )
      .run({
        id: input.id,
        owner: input.owner,
        generation: input.generation,
        nextAttemptAt,
        error,
        now,
      });
    if (update.changes !== 1) throw staleLeaseError(input.id, input.owner, input.generation);
    return this.requireItem(input.id);
  }

  recoverExpired(nowInput: string | Temporal.Instant): AgentWorldWorkRecoveryResult {
    const now = normalizeInstant(nowInput, "World work recovery time");
    const transaction = this.db.transaction(() => {
      const releasedLeases = this.db
        .prepare(
          `UPDATE agent_world_work_items
           SET status = 'pending', lease_owner = NULL, lease_until = NULL,
               next_attempt_at = @now, updated_at = @now
           WHERE status = 'leased' AND lease_until <= @now`,
        )
        .run({ now }).changes;
      const reconciliationRequired = this.db
        .prepare(
          `UPDATE agent_world_work_items
           SET status = 'reconciliation_required', lease_owner = NULL, lease_until = NULL,
               completed_at = @now, last_error = 'Lease expired after execution started; external side effect requires reconciliation.',
               updated_at = @now
           WHERE status = 'running' AND lease_until <= @now`,
        )
        .run({ now }).changes;
      return { releasedLeases, reconciliationRequired } satisfies AgentWorldWorkRecoveryResult;
    });
    return transaction();
  }

  listDue(input: {
    readonly worldId: string;
    readonly now: string | Temporal.Instant;
    readonly limit: number;
    readonly sourceId?: string;
  }): AgentWorldWorkItem[] {
    const worldId = requireText(input.worldId, "World work item world id");
    const now = normalizeInstant(input.now, "World work due time");
    const sourceId =
      input.sourceId === undefined ? undefined : requireText(input.sourceId, "World work item source id");
    assertPositiveLimit(input.limit, "World work due limit");
    const query = sourceId
      ? `SELECT * FROM agent_world_work_items
         WHERE world_id = ? AND source_id = ? AND status IN ('pending', 'failed') AND next_attempt_at <= ?
         ORDER BY next_attempt_at, created_at, id LIMIT ?`
      : `SELECT * FROM agent_world_work_items
         WHERE world_id = ? AND status IN ('pending', 'failed') AND next_attempt_at <= ?
         ORDER BY next_attempt_at, created_at, id LIMIT ?`;
    const params = sourceId ? [worldId, sourceId, now, input.limit] : [worldId, now, input.limit];
    return this.db
      .prepare<unknown[], WorkItemRow>(query)
      .all(...params)
      .map(toWorkItem);
  }

  nextDueAt(worldIdInput: string, sourceIdInput?: string): string | undefined {
    const worldId = requireText(worldIdInput, "World work item world id");
    const sourceId = sourceIdInput === undefined ? undefined : requireText(sourceIdInput, "World work item source id");
    const query = sourceId
      ? `SELECT MIN(next_attempt_at) AS next_attempt_at FROM agent_world_work_items
         WHERE world_id = ? AND source_id = ? AND status IN ('pending', 'failed')`
      : `SELECT MIN(next_attempt_at) AS next_attempt_at FROM agent_world_work_items
         WHERE world_id = ? AND status IN ('pending', 'failed')`;
    const row = this.db
      .prepare<unknown[], { readonly next_attempt_at: string | null }>(query)
      .get(...(sourceId ? [worldId, sourceId] : [worldId]));
    return row?.next_attempt_at ? normalizeInstant(row.next_attempt_at, "Stored world work due time") : undefined;
  }

  hasOutstanding(worldIdInput: string, sourceIdInput?: string): boolean {
    const worldId = requireText(worldIdInput, "World work item world id");
    const sourceId = sourceIdInput === undefined ? undefined : requireText(sourceIdInput, "World work item source id");
    const query = sourceId
      ? `SELECT 1 AS present FROM agent_world_work_items
         WHERE world_id = ? AND source_id = ? AND status IN ('pending', 'leased', 'running', 'failed') LIMIT 1`
      : `SELECT 1 AS present FROM agent_world_work_items
         WHERE world_id = ? AND status IN ('pending', 'leased', 'running', 'failed') LIMIT 1`;
    const row = this.db
      .prepare<unknown[], { readonly present: number }>(query)
      .get(...(sourceId ? [worldId, sourceId] : [worldId]));
    return row?.present === 1;
  }

  cancel(input: {
    readonly id: string;
    readonly now: string | Temporal.Instant;
    readonly reason?: string;
  }): AgentWorldWorkItem {
    const id = requireText(input.id, "World work item id");
    const now = normalizeInstant(input.now, "World work cancellation time");
    const reason = input.reason === undefined ? undefined : requireText(input.reason, "World work cancellation reason");
    this.db
      .prepare(
        `UPDATE agent_world_work_items
         SET status = 'cancelled', lease_owner = NULL, lease_until = NULL, completed_at = @now,
             last_error = @reason, updated_at = @now
         WHERE id = @id AND status NOT IN ('acknowledged', 'unknown', 'cancelled', 'reconciliation_required')`,
      )
      .run({ id, now, reason: reason ?? null });
    return this.requireItem(id);
  }

  get(idInput: string): AgentWorldWorkItem | undefined {
    const id = requireText(idInput, "World work item id");
    const row = this.findRow(id);
    return row ? toWorkItem(row) : undefined;
  }

  private requireCurrentLease(
    input: AgentWorldWorkMutationInput,
    statuses: readonly AgentWorldWorkStatus[],
  ): AgentWorldWorkLease {
    const item = this.get(input.id);
    if (
      !item ||
      !statuses.includes(item.status) ||
      item.leaseOwner !== input.owner ||
      item.leaseGeneration !== input.generation
    ) {
      throw staleLeaseError(input.id, input.owner, input.generation);
    }
    if (
      !item.leaseUntil ||
      Temporal.Instant.compare(
        Temporal.Instant.from(item.leaseUntil),
        normalizeInstant(input.now, "World work mutation time"),
      ) <= 0
    ) {
      throw staleLeaseError(input.id, input.owner, input.generation);
    }
    return { item, owner: input.owner, generation: input.generation, leaseUntil: item.leaseUntil };
  }

  private requireItem(id: string): AgentWorldWorkItem {
    const item = this.get(id);
    if (!item) throw new Error(`World work item does not exist: ${id}.`);
    return item;
  }

  private findRow(id: string): WorkItemRow | undefined {
    return this.db.prepare<[string], WorkItemRow>("SELECT * FROM agent_world_work_items WHERE id = ?").get(id);
  }

  private findByCandidate(worldId: string, sourceId: string, candidateId: string): AgentWorldWorkItem | undefined {
    const row = this.db
      .prepare<[string, string, string], WorkItemRow>(
        "SELECT * FROM agent_world_work_items WHERE world_id = ? AND source_id = ? AND candidate_id = ?",
      )
      .get(worldId, sourceId, candidateId);
    return row ? toWorkItem(row) : undefined;
  }

  private findByRequest(requestId: string): AgentWorldWorkItem | undefined {
    const row = this.db
      .prepare<[string], WorkItemRow>("SELECT * FROM agent_world_work_items WHERE request_id = ?")
      .get(requestId);
    return row ? toWorkItem(row) : undefined;
  }
}

function toLease(row: WorkItemRow, owner: string): AgentWorldWorkLease {
  const item = toWorkItem(row);
  if (!item.leaseUntil) throw new Error(`World work item ${item.id} has no lease expiry.`);
  return { item, owner, generation: item.leaseGeneration, leaseUntil: item.leaseUntil };
}

function toWorkItem(row: WorkItemRow): AgentWorldWorkItem {
  const status = requireStatus(row.status);
  const payload = parseJsonText(row.payload_json, `World work item ${row.id} payload`);
  const result =
    row.result_json === null ? undefined : parseJsonText(row.result_json, `World work item ${row.id} result`);
  return {
    id: requireText(row.id, "Stored world work item id"),
    worldId: requireText(row.world_id, "Stored world work item world id"),
    sourceId: requireText(row.source_id, "Stored world work item source id"),
    candidateId: requireText(row.candidate_id, "Stored world work item candidate id"),
    requestId: requireText(row.request_id, "Stored world work item request id"),
    payloadHash: requireText(row.payload_hash, "Stored world work item payload hash"),
    payload,
    status,
    ...(row.lease_owner ? { leaseOwner: row.lease_owner } : {}),
    leaseGeneration: requireNonNegativeInteger(row.lease_generation, "Stored world work lease generation"),
    ...(row.lease_until ? { leaseUntil: normalizeInstant(row.lease_until, "Stored world work lease expiry") } : {}),
    attemptCount: requireNonNegativeInteger(row.attempt_count, "Stored world work attempt count"),
    nextAttemptAt: normalizeInstant(row.next_attempt_at, "Stored world work next attempt time"),
    ...(row.started_at ? { startedAt: normalizeInstant(row.started_at, "Stored world work start time") } : {}),
    ...(row.completed_at
      ? { completedAt: normalizeInstant(row.completed_at, "Stored world work completion time") }
      : {}),
    ...(result !== undefined ? { result } : {}),
    evidenceRefs: normalizeEvidenceRefs(
      parseJsonText(row.evidence_refs_json, `World work item ${row.id} evidence references`),
    ),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    createdAt: normalizeInstant(row.created_at, "Stored world work creation time"),
    updatedAt: normalizeInstant(row.updated_at, "Stored world work update time"),
  };
}

function assertEnqueueIdentity(
  existing: AgentWorldWorkItem,
  expected: {
    readonly worldId: string;
    readonly sourceId: string;
    readonly candidateId: string;
    readonly requestId: string;
    readonly payloadHash: string;
  },
): void {
  if (
    existing.worldId !== expected.worldId ||
    existing.sourceId !== expected.sourceId ||
    existing.candidateId !== expected.candidateId ||
    existing.requestId !== expected.requestId ||
    existing.payloadHash !== expected.payloadHash
  ) {
    throw new Error(`World work item identity conflict for candidate ${expected.candidateId}.`);
  }
}

function requireStatus(value: string): AgentWorldWorkStatus {
  if ((Object.values(AgentWorldWorkStatuses) as readonly string[]).includes(value))
    return value as AgentWorldWorkStatus;
  throw new Error(`Unsupported stored world work status: ${value}.`);
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new TypeError(`${label} must be a non-empty string.`);
  return value.trim();
}

function normalizeInstant(value: string | Temporal.Instant, label: string): string {
  try {
    return Temporal.Instant.from(value).toString();
  } catch (error) {
    throw new TypeError(`${label} must be a valid Temporal.Instant.`, { cause: error });
  }
}

function assertFutureLease(now: string, leaseUntil: string): void {
  if (Temporal.Instant.compare(Temporal.Instant.from(leaseUntil), Temporal.Instant.from(now)) <= 0) {
    throw new RangeError("World work lease expiry must be after the current time.");
  }
}

function assertPositiveLimit(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer.`);
}

function requireNonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer.`);
  return value;
}

function normalizeEvidenceRefs(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("World work evidence references must be an array.");
  return value.map((entry) => requireText(entry, "World work evidence reference"));
}

function staleLeaseError(id: string, owner: string, generation: number): Error {
  return new Error(`World work lease is stale or expired: item=${id}, owner=${owner}, generation=${generation}.`);
}
