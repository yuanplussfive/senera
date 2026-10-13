import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import Database from "better-sqlite3";
import { z } from "zod";
import { errorMessage } from "../Core/AgentErrors.js";
import { AgentCancellationError, throwAbortReason } from "../Core/AgentCancellation.js";
import {
  planAgentBackgroundLearningRetry,
  type AgentBackgroundLearningRetryPolicy,
} from "./AgentBackgroundLearningRetry.js";
import { AgentInferenceBudgetExceededError } from "../ModelEndpoints/AgentInferenceBudget.js";
import { AgentModelResponseBudgetError } from "../ModelEndpoints/ModelResponseBudget.js";
import {
  AgentInvalidModelToolArgumentsError,
  AgentRequiredModelToolCallError,
} from "../ModelEndpoints/AgentModelFailureMapper.js";
import { ModelProviderHttpError, ModelRequestTimeoutError } from "../ModelEndpoints/ModelHttpErrors.js";
import { AgentBamlStructuredOutputError } from "../BamlClient/AgentBamlStructuredOutputRunner.js";
import { parseMemoryRowJsonObject } from "./AgentMemoryRowJson.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { AgentSqliteDatabaseKernel } from "../Database/AgentSqliteDatabaseKernel.js";
import {
  activeAgentModelUsageLedger,
  AgentModelUsageLedger,
  withAgentModelUsageLedger,
  type AgentModelUsageValue,
} from "../ModelEndpoints/AgentModelUsage.js";

export const AgentBackgroundLearningBoards = [
  "semantic_memory",
  "state_card",
  "tool_observation_compression",
  "memory_prefetch",
] as const;
export type AgentBackgroundLearningBoard = (typeof AgentBackgroundLearningBoards)[number];

export const AgentBackgroundLearningRequestStatuses = ["started", "completed", "failed", "cancelled"] as const;
export type AgentBackgroundLearningRequestStatus = (typeof AgentBackgroundLearningRequestStatuses)[number];

export const AgentBackgroundLearningFailureCodes = [
  "transport",
  "provider_http",
  "tool_contract",
  "schema_validation",
  "persistence",
  "budget",
  "cancelled",
  "unknown",
] as const;
export type AgentBackgroundLearningFailureCode = (typeof AgentBackgroundLearningFailureCodes)[number];

export interface AgentBackgroundLearningRequestStart {
  readonly operationKey: string;
  readonly board: AgentBackgroundLearningBoard;
  readonly stage: string;
  readonly entityUri?: string;
  readonly sourceRevision?: string;
  readonly attempt: number;
  readonly providerId?: string;
  readonly model?: string;
  readonly startedAtMs?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AgentBackgroundLearningRequestFinish {
  readonly usage?: AgentModelUsageValue;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly outputCharacters?: number;
}

export interface AgentBackgroundLearningRequestFailure {
  readonly error: unknown;
  readonly code?: AgentBackgroundLearningFailureCode;
  readonly retryAtMs?: number;
  readonly usage?: AgentModelUsageValue;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AgentBackgroundLearningRequestRecord {
  readonly requestId: string;
  readonly operationKey: string;
  readonly board: AgentBackgroundLearningBoard;
  readonly stage: string;
  readonly entityUri: string | null;
  readonly sourceRevision: string | null;
  readonly attempt: number;
  readonly providerId: string | null;
  readonly model: string | null;
  readonly status: AgentBackgroundLearningRequestStatus;
  readonly startedAt: string;
  readonly startedAtMs: number;
  readonly completedAt: string | null;
  readonly completedAtMs: number | null;
  readonly durationMs: number | null;
  readonly retryAtMs: number | null;
  readonly errorCode: AgentBackgroundLearningFailureCode | null;
  readonly errorMessage: string | null;
  readonly usage?: AgentModelUsageValue;
  readonly metadata: Readonly<Record<string, unknown>>;
}

interface RequestRow {
  readonly request_id: string;
  readonly operation_key: string;
  readonly board: AgentBackgroundLearningBoard;
  readonly stage: string;
  readonly entity_uri: string | null;
  readonly source_revision: string | null;
  readonly attempt: number;
  readonly provider_id: string | null;
  readonly model: string | null;
  readonly status: AgentBackgroundLearningRequestStatus;
  readonly started_at: string;
  readonly started_at_ms: number;
  readonly completed_at: string | null;
  readonly completed_at_ms: number | null;
  readonly duration_ms: number | null;
  readonly retry_at_ms: number | null;
  readonly error_code: AgentBackgroundLearningFailureCode | null;
  readonly error_message: string | null;
  readonly usage_json: string | null;
  readonly metadata_json: string;
}

export interface AgentBackgroundLearningRequestHandle {
  readonly requestId: string;
  complete(input?: AgentBackgroundLearningRequestFinish): void;
  fail(input: AgentBackgroundLearningRequestFailure): void;
  cancel(reason?: unknown): void;
}

const DiagnosticMessageLimit = 2_000;

/** Durable, redacted lifecycle ledger for detached learning/model work. */
export class AgentBackgroundLearningRequestLedger {
  private readonly db: Database.Database;

  constructor(
    database: AgentSqliteDatabaseKernel | Database.Database,
    private readonly logger?: AgentLogger,
  ) {
    this.db = "connection" in database ? database.connection : database;
  }

  begin(input: AgentBackgroundLearningRequestStart): AgentBackgroundLearningRequestHandle {
    const operationKey = requireText(input.operationKey, "learning request operation key");
    const stage = requireText(input.stage, "learning request stage");
    const attempt = requireAttempt(input.attempt);
    const startedAtMs = input.startedAtMs ?? Date.now();
    if (!Number.isSafeInteger(startedAtMs)) throw new Error("Learning request start time must be a safe integer.");
    const requestId = randomUUID();
    const startedAt = new Date(startedAtMs).toISOString();
    this.write("begin", () => {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO memory_background_learning_requests
            (request_id, operation_key, board, stage, entity_uri, source_revision, attempt,
             provider_id, model, status, started_at, started_at_ms, metadata_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'started', ?, ?, ?)`,
        )
        .run(
          requestId,
          operationKey,
          input.board,
          stage,
          input.entityUri ?? null,
          input.sourceRevision ?? null,
          attempt,
          input.providerId ?? null,
          input.model ?? null,
          startedAt,
          startedAtMs,
          serializeJson(input.metadata ?? {}),
        );
    });

    return {
      requestId,
      complete: (finish = {}) => this.complete(requestId, finish),
      fail: (failure) => this.fail(requestId, failure),
      cancel: (reason) =>
        this.fail(requestId, {
          error: reason ?? new Error("Learning request cancelled."),
          code: "cancelled",
        }),
    };
  }

  async run<T>(
    input: AgentBackgroundLearningRequestStart,
    operation: (handle: AgentBackgroundLearningRequestHandle) => Promise<T>,
    finish?: (result: T) => AgentBackgroundLearningRequestFinish,
  ): Promise<T> {
    const handle = this.begin(input);
    const usage = new AgentModelUsageLedger(activeAgentModelUsageLedger());
    try {
      const result = await withAgentModelUsageLedger(usage, () => operation(handle));
      handle.complete({ ...finish?.(result), usage: usage.aggregate() });
      return result;
    } catch (error) {
      handle.fail({ error, usage: usage.aggregate() });
      throw error;
    }
  }

  /** Durable jobs own one total attempt budget, including recovery after restart. */
  async runRetried<T>(
    input: Omit<AgentBackgroundLearningRequestStart, "attempt" | "startedAtMs">,
    policy: AgentBackgroundLearningRetryPolicy,
    operation: (attempt: number) => Promise<T>,
    finish?: (result: T) => AgentBackgroundLearningRequestFinish,
    signal?: AbortSignal,
  ): Promise<T> {
    const previous = this.listAll({ board: input.board, stage: input.stage })
      .filter(
        (record) =>
          record.operationKey === input.operationKey &&
          record.entityUri === (input.entityUri ?? null) &&
          record.sourceRevision === (input.sourceRevision ?? null),
      )
      .sort((left, right) => right.attempt - left.attempt || right.startedAtMs - left.startedAtMs)[0];
    let attempt = previous && previous.status !== "completed" ? previous.attempt + 1 : 1;
    if (attempt > policy.maxAttempts)
      throw new Error(
        `Background learning exhausted its configured attempts: ${input.operationKey}. ${previous?.errorMessage ?? ""}`,
      );
    const waitUntil = async (deadline: number) => {
      try {
        await delay(Math.max(0, deadline - Date.now()), undefined, { signal });
      } catch (error) {
        throwAbortReason(signal);
        throw error;
      }
    };
    if (previous?.retryAtMs) await waitUntil(previous.retryAtMs);
    for (;;) {
      throwAbortReason(signal);
      const handle = this.begin({ ...input, attempt });
      const usage = new AgentModelUsageLedger(activeAgentModelUsageLedger());
      try {
        const result = await withAgentModelUsageLedger(usage, () => operation(attempt));
        handle.complete({ ...finish?.(result), usage: usage.aggregate() });
        return result;
      } catch (error) {
        const retry = planAgentBackgroundLearningRetry({
          attempt,
          nowMs: Date.now(),
          policy,
          retryable: !signal?.aborted,
        });
        handle.fail({
          error,
          usage: usage.aggregate(),
          ...(retry.kind === "failed" ? {} : { retryAtMs: retry.nextAttemptAtMs }),
        });
        if (retry.kind === "failed") {
          throwAbortReason(signal);
          throw error;
        }
        await waitUntil(retry.nextAttemptAtMs);
        attempt += 1;
      }
    }
  }

  list(
    input: {
      readonly board?: AgentBackgroundLearningBoard;
      readonly stage?: string;
      readonly status?: AgentBackgroundLearningRequestStatus;
      readonly entityUri?: string;
      readonly sourceRevision?: string;
      readonly limit?: number;
    } = {},
  ): AgentBackgroundLearningRequestRecord[] {
    const clauses = ["1 = 1"];
    const bindings: Record<string, unknown> = {};
    if (input.board) {
      clauses.push("board = @board");
      bindings.board = input.board;
    }
    if (input.stage) {
      clauses.push("stage = @stage");
      bindings.stage = input.stage;
    }
    if (input.status) {
      clauses.push("status = @status");
      bindings.status = input.status;
    }
    if (input.entityUri) {
      clauses.push("entity_uri = @entityUri");
      bindings.entityUri = input.entityUri;
    }
    if (input.sourceRevision) {
      clauses.push("source_revision = @sourceRevision");
      bindings.sourceRevision = input.sourceRevision;
    }
    const limit = normalizeLimit(input.limit);
    bindings.limit = limit;
    return this.db
      .prepare<Record<string, unknown>, RequestRow>(
        `SELECT * FROM memory_background_learning_requests
          WHERE ${clauses.join(" AND ")}
          ORDER BY started_at_ms DESC, rowid DESC LIMIT @limit`,
      )
      .all(bindings)
      .map(decodeRequest);
  }

  listAll(
    input: {
      readonly board?: AgentBackgroundLearningBoard;
      readonly stage?: string;
      readonly status?: AgentBackgroundLearningRequestStatus;
    } = {},
  ): AgentBackgroundLearningRequestRecord[] {
    const row = this.db
      .prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM memory_background_learning_requests")
      .get();
    if (!row || row.count === 0) return [];
    return this.list({ ...input, limit: row.count });
  }

  private complete(requestId: string, input: AgentBackgroundLearningRequestFinish): void {
    const completedAtMs = Date.now();
    this.write("complete", () => {
      this.db
        .prepare(
          `UPDATE memory_background_learning_requests
              SET status = 'completed', completed_at = ?, completed_at_ms = ?,
                  duration_ms = MAX(0, ? - started_at_ms), retry_at_ms = NULL,
                  error_code = NULL, error_message = NULL,
                  usage_json = ?, metadata_json = json_patch(metadata_json, ?)
            WHERE request_id = ? AND status = 'started'`,
        )
        .run(
          new Date(completedAtMs).toISOString(),
          completedAtMs,
          completedAtMs,
          input.usage ? serializeJson(input.usage) : null,
          serializeJson(input.metadata ?? {}),
          requestId,
        );
    });
  }

  private fail(requestId: string, input: AgentBackgroundLearningRequestFailure): void {
    const completedAtMs = Date.now();
    const code = input.code ?? classifyFailure(input.error);
    this.write("fail", () => {
      this.db
        .prepare(
          `UPDATE memory_background_learning_requests
              SET status = ?, completed_at = ?, completed_at_ms = ?,
                  duration_ms = MAX(0, ? - started_at_ms), retry_at_ms = ?,
                  error_code = ?, error_message = ?, usage_json = ?,
                  metadata_json = json_patch(metadata_json, ?)
            WHERE request_id = ? AND status = 'started'`,
        )
        .run(
          code === "cancelled" ? "cancelled" : "failed",
          new Date(completedAtMs).toISOString(),
          completedAtMs,
          completedAtMs,
          input.retryAtMs ?? null,
          code,
          truncate(errorMessage(input.error)),
          input.usage ? serializeJson(input.usage) : null,
          serializeJson(input.metadata ?? {}),
          requestId,
        );
    });
  }

  private write(operation: string, write: () => void): void {
    try {
      write();
    } catch (error) {
      this.logger?.warn("memory.learning_request.persist_failed", {
        operation,
        message: truncate(errorMessage(error)),
      });
      throw error;
    }
  }
}

function decodeRequest(row: RequestRow): AgentBackgroundLearningRequestRecord {
  const usage = row.usage_json ? parseMemoryRowJsonObject(row.usage_json) : undefined;
  return {
    requestId: row.request_id,
    operationKey: row.operation_key,
    board: row.board,
    stage: row.stage,
    entityUri: row.entity_uri,
    sourceRevision: row.source_revision,
    attempt: row.attempt,
    providerId: row.provider_id,
    model: row.model,
    status: row.status,
    startedAt: row.started_at,
    startedAtMs: row.started_at_ms,
    completedAt: row.completed_at,
    completedAtMs: row.completed_at_ms,
    durationMs: row.duration_ms,
    retryAtMs: row.retry_at_ms,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    ...(usage ? { usage: usage as unknown as AgentModelUsageValue } : {}),
    metadata: parseMemoryRowJsonObject(row.metadata_json),
  };
}

function classifyFailure(error: unknown): AgentBackgroundLearningFailureCode {
  const seen = new Set<Error>();
  for (let current = error; current instanceof Error && !seen.has(current); current = current.cause) {
    seen.add(current);
    if (current instanceof AgentCancellationError || (current instanceof DOMException && current.name === "AbortError"))
      return "cancelled";
    if (current instanceof AgentInferenceBudgetExceededError || current instanceof AgentModelResponseBudgetError)
      return "budget";
    if (current instanceof AgentInvalidModelToolArgumentsError || current instanceof AgentRequiredModelToolCallError)
      return "tool_contract";
    if (
      current instanceof z.ZodError ||
      current instanceof SyntaxError ||
      current instanceof AgentBamlStructuredOutputError
    )
      return "schema_validation";
    if (current instanceof ModelProviderHttpError) return "provider_http";
    if (current instanceof ModelRequestTimeoutError) return "transport";
    if (current instanceof Database.SqliteError) return "persistence";
  }
  return "unknown";
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be empty.`);
  return normalized;
}

function requireAttempt(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error("Learning request attempt must be a positive safe integer.");
  return value;
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return 100;
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error("Learning request list limit must be a positive safe integer.");
  return value;
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function truncate(value: string): string {
  return value.length <= DiagnosticMessageLimit ? value : `${value.slice(0, DiagnosticMessageLimit - 1)}…`;
}
