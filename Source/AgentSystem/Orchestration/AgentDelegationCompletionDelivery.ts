import type Database from "better-sqlite3";
import { createOpaqueId } from "../Core/AgentIds.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { agentSql } from "../Database/AgentSql.js";
import type { AgentOrchestrationDatabase } from "./AgentOrchestrationDatabase.js";
import { AgentChildRunStatuses, type AgentChildRunRecord, type AgentChildRunRepository } from "./AgentChildRunTypes.js";
import type { AgentDelegationCompletionPort } from "./AgentDelegationRuntimeContracts.js";

export const AgentDelegationCompletionDeliveryDefaults = Object.freeze({
  claimLeaseMs: 5 * 60_000,
  maxAttempts: 8,
  retryDelaysMs: Object.freeze([2_000, 5_000, 10_000, 30_000, 60_000, 5 * 60_000, 15 * 60_000]),
  batchSize: 16,
});

export interface AgentDelegationCompletionDeliveryOptions {
  readonly database: AgentOrchestrationDatabase;
  readonly repository: Pick<AgentChildRunRepository, "get">;
  readonly now?: () => Date;
  readonly claimLeaseMs?: number;
  readonly maxAttempts?: number;
  readonly retryDelaysMs?: readonly number[];
  readonly batchSize?: number;
  readonly onError?: (error: unknown, portId: string) => void;
}

interface CompletionDeliveryRow {
  readonly id: string;
  readonly child_run_id: string;
  readonly port_id: string;
  readonly delivery_status: "pending" | "claimed" | "delivered" | "dropped";
  readonly attempt: number;
  readonly available_at: string;
  readonly claim_id: string | null;
  readonly claim_until: string | null;
  readonly last_error: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly delivered_at: string | null;
}

interface CompletionDeliveryClaim extends CompletionDeliveryRow {
  readonly claim_id: string;
  readonly claim_until: string;
  readonly attempt: number;
  readonly delivery_status: "claimed";
}

interface CompletionDeliveryStatements {
  readonly enqueue: Database.Statement;
  readonly selectDue: Database.Statement;
  readonly selectNext: Database.Statement;
  readonly claim: Database.Statement;
  readonly renewClaim: Database.Statement;
  readonly markDelivered: Database.Statement;
  readonly release: Database.Statement;
  readonly drop: Database.Statement;
}

/**
 * Durable terminal-result delivery for channel adapters.
 *
 * A completion is first recorded per `(childRunId, portId)`, then claimed by
 * one runtime instance. Adapter failures release the claim with an explicit
 * retry time; crashed workers leave an expiring claim that another instance
 * can recover. This keeps delivery semantics out of the child-run worker and
 * avoids process-local queues that disappear during a restart.
 */
export class AgentDelegationCompletionDelivery {
  readonly id = "senera.completion-delivery";
  private readonly statements: CompletionDeliveryStatements;
  private readonly claimOne: (
    portId: string,
    now: string,
    claimId: string,
    claimUntil: string,
  ) => CompletionDeliveryClaim | undefined;
  private readonly ports = new Map<string, AgentDelegationCompletionPort>();
  private readonly pumps = new Map<string, Promise<void>>();
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly now: () => Date;
  private readonly claimLeaseMs: number;
  private readonly maxAttempts: number;
  private readonly retryDelaysMs: readonly number[];
  private readonly batchSize: number;
  private stopped = false;

  constructor(private readonly options: AgentDelegationCompletionDeliveryOptions) {
    this.now = options.now ?? (() => new Date());
    this.claimLeaseMs = positiveInteger(
      options.claimLeaseMs ?? AgentDelegationCompletionDeliveryDefaults.claimLeaseMs,
      "claimLeaseMs",
    );
    this.maxAttempts = positiveInteger(
      options.maxAttempts ?? AgentDelegationCompletionDeliveryDefaults.maxAttempts,
      "maxAttempts",
    );
    this.retryDelaysMs = Object.freeze([
      ...(options.retryDelaysMs ?? AgentDelegationCompletionDeliveryDefaults.retryDelaysMs),
    ]);
    if (
      this.retryDelaysMs.length === 0 ||
      this.retryDelaysMs.some((delay) => !Number.isSafeInteger(delay) || delay < 0)
    ) {
      throw new Error("retryDelaysMs must contain at least one non-negative safe integer.");
    }
    this.batchSize = positiveInteger(
      options.batchSize ?? AgentDelegationCompletionDeliveryDefaults.batchSize,
      "batchSize",
    );
    this.statements = prepareStatements(options.database.connection);
    this.claimOne = options.database.connection.transaction(
      (portId: string, now: string, claimId: string, claimUntil: string) => {
        const row = this.statements.selectDue.get(portId, now, now) as CompletionDeliveryRow | undefined;
        if (!row) return undefined;
        const changed = this.statements.claim.run({
          id: row.id,
          claim_id: claimId,
          claim_until: claimUntil,
          now,
          updated_at: now,
        }).changes;
        if (changed !== 1) return undefined;
        return {
          ...row,
          delivery_status: "claimed" as const,
          attempt: row.attempt + 1,
          claim_id: claimId,
          claim_until: claimUntil,
        };
      },
    );
  }

  bind(port: AgentDelegationCompletionPort): () => void {
    this.assertAcceptingWork();
    const portId = normalizePortId(port.id);
    if (this.ports.has(portId)) throw new Error(`Completion port is already bound: ${portId}`);
    this.ports.set(portId, port);
    void this.pump(portId).catch((error) => this.reportError(error, portId));
    return () => {
      if (this.ports.get(portId) === port) {
        this.ports.delete(portId);
        this.clearRetryTimer(portId);
      }
    };
  }

  async completed(record: AgentChildRunRecord): Promise<void> {
    this.assertAcceptingWork();
    if (!TerminalChildRunStatuses.has(record.status)) {
      throw new Error(`Completion delivery requires a terminal child run: ${record.id}/${record.status}`);
    }
    const ports = [...this.ports.values()];
    await Promise.all(ports.map((port) => this.enqueue(port.id, record.id)));
  }

  async replay(): Promise<void> {
    this.assertAcceptingWork();
    await Promise.all([...this.ports.keys()].map((portId) => this.pump(portId)));
  }

  async stop(): Promise<void> {
    this.stopped = true;
    for (const portId of this.retryTimers.keys()) this.clearRetryTimer(portId);
    await Promise.allSettled([...this.pumps.values()]);
  }

  private async enqueue(portId: string, childRunId: string): Promise<void> {
    const now = this.isoNow();
    this.statements.enqueue.run({
      id: createCompletionDeliveryId(childRunId, portId),
      child_run_id: childRunId,
      port_id: normalizePortId(portId),
      available_at: now,
      created_at: now,
      updated_at: now,
    });
    await this.pump(normalizePortId(portId));
  }

  private pump(portId: string): Promise<void> {
    const existing = this.pumps.get(portId);
    if (existing) return existing;
    // A newly enqueued row supersedes any timer waiting on an older retry.
    // Clearing here also prevents a stale timer from waking an otherwise idle
    // adapter after its queue has already drained.
    this.clearRetryTimer(portId);
    const promise = this.drain(portId).finally(() => {
      if (this.pumps.get(portId) === promise) this.pumps.delete(portId);
    });
    this.pumps.set(portId, promise);
    return promise;
  }

  private async drain(portId: string): Promise<void> {
    // Binding a port may start a replay pump just before a completion is
    // enqueued. Yield once so that enqueue and replay share the same drain
    // instead of resolving an empty pump and missing the new row.
    await Promise.resolve();
    while (!this.stopped && this.ports.has(portId)) {
      let processed = 0;
      while (processed < this.batchSize && !this.stopped && this.ports.has(portId)) {
        const now = this.isoNow();
        const claim = this.claimOne(
          portId,
          now,
          createOpaqueId("completionclaim"),
          new Date(this.now().getTime() + this.claimLeaseMs).toISOString(),
        );
        if (!claim) {
          this.scheduleNext(portId);
          return;
        }
        processed += 1;
        const record = this.options.repository.get(claim.child_run_id);
        if (!record) {
          this.statements.drop.run({
            id: claim.id,
            claim_id: claim.claim_id,
            error: "Child run no longer exists.",
            updated_at: this.isoNow(),
          });
          continue;
        }
        const port = this.ports.get(portId);
        if (!port) return;
        const renewal = this.startClaimRenewal(claim);
        try {
          await port.completed(record);
          this.statements.markDelivered.run({
            id: claim.id,
            claim_id: claim.claim_id,
            delivered_at: this.isoNow(),
            updated_at: this.isoNow(),
          });
        } catch (error) {
          await this.releaseAfterFailure(claim, error);
        } finally {
          clearInterval(renewal);
        }
      }
    }
  }

  private scheduleNext(portId: string): void {
    if (this.stopped || !this.ports.has(portId)) return;
    const row = this.statements.selectNext.get(portId) as { available_at: string | null } | undefined;
    if (!row?.available_at) {
      this.clearRetryTimer(portId);
      return;
    }
    this.clearRetryTimer(portId);
    const dueAt = new Date(row.available_at).getTime();
    const delay = Math.max(0, dueAt - this.now().getTime());
    const timer = setTimeout(() => {
      this.retryTimers.delete(portId);
      void this.pump(portId).catch((error) => this.reportError(error, portId));
    }, delay);
    timer.unref?.();
    this.retryTimers.set(portId, timer);
  }

  private clearRetryTimer(portId: string): void {
    const timer = this.retryTimers.get(portId);
    if (!timer) return;
    clearTimeout(timer);
    this.retryTimers.delete(portId);
  }

  private startClaimRenewal(claim: CompletionDeliveryClaim): ReturnType<typeof setInterval> {
    const intervalMs = Math.max(1_000, Math.floor(this.claimLeaseMs / 2));
    const timer = setInterval(() => {
      const now = this.isoNow();
      this.statements.renewClaim.run({
        id: claim.id,
        claim_id: claim.claim_id,
        claim_until: new Date(this.now().getTime() + this.claimLeaseMs).toISOString(),
        now,
        updated_at: now,
      });
    }, intervalMs);
    timer.unref?.();
    return timer;
  }

  private async releaseAfterFailure(claim: CompletionDeliveryClaim, error: unknown): Promise<void> {
    const message = errorMessage(error);
    if (claim.attempt >= this.maxAttempts) {
      this.statements.drop.run({
        id: claim.id,
        claim_id: claim.claim_id,
        error: message,
        updated_at: this.isoNow(),
      });
      this.reportError(
        new Error(`Completion delivery dropped after ${claim.attempt} attempts: ${message}`),
        claim.port_id,
      );
      return;
    }
    const retryIndex = Math.min(claim.attempt - 1, this.retryDelaysMs.length - 1);
    const availableAt = new Date(this.now().getTime() + this.retryDelaysMs[retryIndex]).toISOString();
    this.statements.release.run({
      id: claim.id,
      claim_id: claim.claim_id,
      available_at: availableAt,
      error: message,
      updated_at: this.isoNow(),
    });
  }

  private isoNow(): string {
    return this.now().toISOString();
  }

  private assertAcceptingWork(): void {
    if (this.stopped) throw new Error("Completion delivery is stopped.");
  }

  private reportError(error: unknown, portId: string): void {
    this.options.onError?.(error, portId);
  }
}

const TerminalChildRunStatuses = new Set<AgentChildRunRecord["status"]>([
  AgentChildRunStatuses.Completed,
  AgentChildRunStatuses.PartialCompleted,
  AgentChildRunStatuses.Interrupted,
  AgentChildRunStatuses.TimedOut,
  AgentChildRunStatuses.Failed,
  AgentChildRunStatuses.Cancelled,
]);

function normalizePortId(value: string): string {
  const portId = value.trim();
  if (!portId) throw new Error("Completion port id must be a non-empty string.");
  return portId;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer.`);
  return value;
}

function createCompletionDeliveryId(childRunId: string, portId: string): string {
  return `completion_delivery_${encodeURIComponent(childRunId)}_${encodeURIComponent(portId)}`;
}

function prepareStatements(database: Database.Database): CompletionDeliveryStatements {
  return {
    enqueue: database.prepare(
      agentSql`INSERT INTO child_run_completion_deliveries (
        id, child_run_id, port_id, delivery_status, attempt, available_at, created_at, updated_at
      ) VALUES (@id, @child_run_id, @port_id, 'pending', 0, @available_at, @created_at, @updated_at)
      ON CONFLICT (child_run_id, port_id) DO NOTHING`,
    ),
    selectDue: database.prepare(
      agentSql`SELECT id, child_run_id, port_id, delivery_status, attempt, available_at,
        claim_id, claim_until, last_error, created_at, updated_at, delivered_at
      FROM child_run_completion_deliveries
      WHERE port_id = ?
        AND available_at <= ?
        AND (
          delivery_status = 'pending'
          OR (delivery_status = 'claimed' AND claim_until IS NOT NULL AND claim_until <= ?)
        )
      ORDER BY created_at, id
      LIMIT 1`,
    ),
    selectNext: database.prepare(
      agentSql`SELECT MIN(
        CASE WHEN delivery_status = 'claimed' THEN claim_until ELSE available_at END
      ) AS available_at
      FROM child_run_completion_deliveries
      WHERE port_id = ? AND delivery_status IN ('pending', 'claimed')`,
    ),
    claim: database.prepare(
      agentSql`UPDATE child_run_completion_deliveries
      SET delivery_status = 'claimed', claim_id = @claim_id, claim_until = @claim_until,
        attempt = attempt + 1, last_error = NULL, updated_at = @updated_at
      WHERE id = @id AND (
        delivery_status = 'pending'
        OR (delivery_status = 'claimed' AND claim_until IS NOT NULL AND claim_until <= @now)
      )`,
    ),
    renewClaim: database.prepare(
      agentSql`UPDATE child_run_completion_deliveries
      SET claim_until = @claim_until, updated_at = @updated_at
      WHERE id = @id AND claim_id = @claim_id AND delivery_status = 'claimed'`,
    ),
    markDelivered: database.prepare(
      agentSql`UPDATE child_run_completion_deliveries
      SET delivery_status = 'delivered', claim_id = NULL, claim_until = NULL,
        delivered_at = @delivered_at, last_error = NULL, updated_at = @updated_at
      WHERE id = @id AND claim_id = @claim_id AND delivery_status = 'claimed'`,
    ),
    release: database.prepare(
      agentSql`UPDATE child_run_completion_deliveries
      SET delivery_status = 'pending', claim_id = NULL, claim_until = NULL,
        available_at = @available_at, last_error = @error, updated_at = @updated_at
      WHERE id = @id AND claim_id = @claim_id AND delivery_status = 'claimed'`,
    ),
    drop: database.prepare(
      agentSql`UPDATE child_run_completion_deliveries
      SET delivery_status = 'dropped', claim_id = NULL, claim_until = NULL,
        last_error = @error, updated_at = @updated_at
      WHERE id = @id AND claim_id = @claim_id AND delivery_status = 'claimed'`,
    ),
  };
}
