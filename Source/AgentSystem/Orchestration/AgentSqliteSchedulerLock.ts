import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { SchedulerLock } from "@amaster.ai/pi-task-scheduler";
import { agentSql } from "../Database/AgentSql.js";
import type { AgentOrchestrationDatabase } from "./AgentOrchestrationDatabase.js";

interface AgentSchedulerLeaseRow {
  readonly holder_id: string;
  readonly holder_pid: number;
  readonly lease_until_ms: number;
}

export interface AgentSqliteSchedulerLockOptions {
  readonly name: string;
  readonly path: string;
  readonly leaseDurationMs: number;
  readonly holderId?: string;
  readonly holderPid?: number;
  readonly now?: () => number;
}

export class AgentSqliteSchedulerLock implements SchedulerLock {
  readonly path: string;
  private readonly holderId: string;
  private readonly holderPidValue: number;
  private readonly now: () => number;
  private readonly acquireStatement: Database.Statement;
  private readonly extendStatement: Database.Statement;
  private readonly releaseStatement: Database.Statement;
  private readonly selectStatement: Database.Statement<[string], AgentSchedulerLeaseRow>;
  private acquired = false;

  constructor(
    database: AgentOrchestrationDatabase,
    private readonly options: AgentSqliteSchedulerLockOptions,
  ) {
    if (!Number.isSafeInteger(options.leaseDurationMs) || options.leaseDurationMs < 1) {
      throw new Error("Scheduler lease duration must be a positive safe integer.");
    }
    this.path = options.path;
    this.holderId = options.holderId ?? randomUUID();
    this.holderPidValue = options.holderPid ?? process.pid;
    this.now = options.now ?? Date.now;
    this.acquireStatement = database.connection.prepare(
      agentSql`INSERT INTO scheduler_leases (
                 name, holder_id, holder_pid, acquired_at_ms, lease_until_ms, updated_at_ms, generation
               ) VALUES (
                 @name, @holder_id, @holder_pid, @now_ms, @lease_until_ms, @now_ms, 1
               )
               ON CONFLICT (name) DO UPDATE SET
                 holder_id = excluded.holder_id,
                 holder_pid = excluded.holder_pid,
                 acquired_at_ms = excluded.acquired_at_ms,
                 lease_until_ms = excluded.lease_until_ms,
                 updated_at_ms = excluded.updated_at_ms,
                 generation = scheduler_leases.generation + 1
               WHERE scheduler_leases.lease_until_ms <= @now_ms
                  OR scheduler_leases.holder_id = @holder_id`,
    );
    this.extendStatement = database.connection.prepare(
      agentSql`UPDATE scheduler_leases
               SET lease_until_ms = @lease_until_ms, updated_at_ms = @now_ms
               WHERE name = @name AND holder_id = @holder_id AND lease_until_ms > @now_ms`,
    );
    this.releaseStatement = database.connection.prepare(
      agentSql`DELETE FROM scheduler_leases WHERE name = @name AND holder_id = @holder_id`,
    );
    this.selectStatement = database.connection.prepare(
      agentSql`SELECT holder_id, holder_pid, lease_until_ms FROM scheduler_leases WHERE name = ?`,
    );
  }

  acquire(): boolean {
    const now = this.now();
    this.acquired =
      this.acquireStatement.run({
        name: this.options.name,
        holder_id: this.holderId,
        holder_pid: this.holderPidValue,
        now_ms: now,
        lease_until_ms: now + this.options.leaseDurationMs,
      }).changes > 0;
    return this.acquired;
  }

  extend(): boolean {
    if (!this.acquired) return false;
    const now = this.now();
    this.acquired =
      this.extendStatement.run({
        name: this.options.name,
        holder_id: this.holderId,
        now_ms: now,
        lease_until_ms: now + this.options.leaseDurationMs,
      }).changes > 0;
    return this.acquired;
  }

  release(): void {
    this.releaseStatement.run({ name: this.options.name, holder_id: this.holderId });
    this.acquired = false;
  }

  isAcquired(): boolean {
    const lease = this.selectStatement.get(this.options.name);
    this.acquired = Boolean(this.acquired && lease?.holder_id === this.holderId && lease.lease_until_ms > this.now());
    return this.acquired;
  }

  holderPid(): number | undefined {
    const lease = this.selectStatement.get(this.options.name);
    return lease && lease.lease_until_ms > this.now() ? lease.holder_pid : undefined;
  }
}
