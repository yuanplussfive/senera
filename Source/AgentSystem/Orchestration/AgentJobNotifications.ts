import type Database from "better-sqlite3";
import type { AgentSessionManager } from "../Session/AgentSessionManager.js";
import type { AgentSessionInputBoundary, AgentSessionQueuedInput } from "../Session/AgentSessionQueuedInput.js";
import type { AgentJobsConfiguration } from "./AgentOrchestrationConfig.js";

interface NoticeRow {
  job_id: string;
  session_id: string;
  delivery_id: string;
  payload_json: string;
  state: "pending" | "admitted" | "observed";
  wake: number | null;
}

interface ObservationRow {
  job_id: string;
  session_id: string;
  request_id: string;
  tool_call_id: string;
  acknowledges: number;
}

type HostInput = Parameters<AgentSessionManager["acceptHostInput"]>[0];

/** Producers persist completion; only native transcript commits acknowledge observation. */
export class AgentJobNotifications {
  private readonly deliveries = new Map<string, Promise<void>>();
  private stopped = false;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private recovery?: Promise<void>;

  constructor(
    private readonly options: {
      database: Database.Database;
      inbox: Pick<AgentSessionManager, "acceptHostInput" | "withdrawHostInput">;
      configuration: () => AgentJobsConfiguration;
      readCommittedToolCalls?: (sessionId: string) => Promise<ReadonlySet<string>>;
      onError: (error: unknown) => void;
      retryDelayMs: number;
    },
  ) {}

  async publish(jobId: string, input: HostInput): Promise<void> {
    this.options.database
      .prepare(
        `INSERT INTO agent_job_notifications(job_id, session_id, delivery_id, payload_json, state, wake)
      VALUES (?, ?, ?, ?, 'pending', ?) ON CONFLICT(job_id) DO NOTHING`,
      )
      .run(
        jobId,
        input.sessionId,
        input.deliveryId,
        JSON.stringify(input),
        input.wake === undefined ? null : Number(input.wake),
      );
    await this.deliver(jobId);
  }

  begin(jobId: string, sessionId: string, requestId?: string, toolCallId?: string) {
    if (!requestId || !toolCallId) return { finish: (_acknowledges: boolean) => {}, failed: async () => {} };
    this.options.database
      .prepare(
        `INSERT INTO agent_job_observations(job_id, session_id, request_id, tool_call_id, acknowledges)
      VALUES (?, ?, ?, ?, 0) ON CONFLICT(session_id, request_id, tool_call_id) DO NOTHING`,
      )
      .run(jobId, sessionId, requestId, toolCallId);
    return {
      finish: (acknowledges: boolean) => {
        this.options.database
          .prepare(
            `UPDATE agent_job_observations SET acknowledges=?
          WHERE session_id=? AND request_id=? AND tool_call_id=?`,
          )
          .run(Number(acknowledges), sessionId, requestId, toolCallId);
      },
      failed: async () => {
        this.removeObservation({
          job_id: jobId,
          session_id: sessionId,
          request_id: requestId,
          tool_call_id: toolCallId,
          acknowledges: 0,
        });
        await this.deliver(jobId);
      },
    };
  }

  inputAccepted(input: AgentSessionQueuedInput): void {
    if (!input.entry.metadata?.hostInput) this.resetWakeBudget(input.sessionId, input.requestId);
  }

  async observed(boundary: AgentSessionInputBoundary): Promise<void> {
    if (boundary.phase === "start" && boundary.humanInput) this.resetWakeBudget(boundary.sessionId, boundary.requestId);
    if (boundary.phase === "start" && isCompletion(boundary.hostInput) && boundary.hostInput?.wake !== false) {
      this.options.database
        .prepare(
          `INSERT INTO agent_job_wake_budgets(session_id, consecutive, last_wake_request) VALUES (?, 1, ?)
        ON CONFLICT(session_id) DO UPDATE SET consecutive=consecutive+1, last_wake_request=excluded.last_wake_request
        WHERE last_wake_request IS NOT excluded.last_wake_request`,
        )
        .run(boundary.sessionId, boundary.requestId);
    }
    if (!boundary.committedToolCalls) return;
    await this.reconcile(boundary.sessionId, boundary.committedToolCalls);
    await this.flush(boundary.sessionId);
  }

  canWake(inputs: readonly AgentSessionQueuedInput[]): boolean {
    const wakeable = inputs.filter((input) => input.entry.metadata?.hostInput?.wake !== false);
    if (wakeable.some((input) => !isCompletion(input.entry.metadata?.hostInput))) return true;
    if (!wakeable.length) return false;
    return this.deliveryPolicy(wakeable[0]!.sessionId).can_wake_idle;
  }

  deliveryPolicy(sessionId: string) {
    const policy = this.options.configuration();
    const budget = this.options.database
      .prepare("SELECT consecutive FROM agent_job_wake_budgets WHERE session_id=?")
      .get(sessionId) as { consecutive: number } | undefined;
    const remaining =
      policy.maxConsecutiveWakes == null ? null : Math.max(0, policy.maxConsecutiveWakes - (budget?.consecutive ?? 0));
    return {
      mode: policy.completionDelivery,
      remaining_wakes: remaining,
      can_wake_idle: policy.completionDelivery === "wakeup" && (remaining === null || remaining > 0),
    };
  }

  async replay(): Promise<void> {
    // Cold recovery must never clear observations belonging to live tool calls.
    await (this.recovery ??= this.recoverObservations().catch((error: unknown) => {
      this.recovery = undefined;
      throw error;
    }));
    await this.flush();
  }

  private async recoverObservations(): Promise<void> {
    const sessions = this.options.database.prepare("SELECT DISTINCT session_id FROM agent_job_observations").all() as {
      session_id: string;
    }[];
    for (const { session_id } of sessions) {
      if (!this.options.readCommittedToolCalls)
        throw new Error("Job observation recovery requires native tool-result receipts.");
      await this.reconcile(session_id, await this.options.readCommittedToolCalls(session_id));
    }
  }

  removeOwnerSession(sessionId: string): void {
    this.options.database.transaction(() => {
      for (const table of ["agent_job_notifications", "agent_job_observations", "agent_job_wake_budgets"])
        this.options.database.prepare(`DELETE FROM ${table} WHERE session_id=?`).run(sessionId);
    })();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    await Promise.allSettled(this.deliveries.values());
  }

  private async reconcile(sessionId: string, committed: ReadonlySet<string>): Promise<void> {
    const observations = this.options.database
      .prepare("SELECT * FROM agent_job_observations WHERE session_id=?")
      .all(sessionId) as ObservationRow[];
    for (const observation of observations) {
      if (
        observation.acknowledges &&
        committed.has(JSON.stringify([observation.request_id, observation.tool_call_id]))
      ) {
        // Create the receipt even when a requested kill has not settled yet.
        this.options.database
          .prepare(
            `INSERT INTO agent_job_notifications(job_id, session_id, delivery_id, payload_json, state)
          VALUES (?, ?, '', '{}', 'observed') ON CONFLICT(job_id) DO UPDATE SET state='observed'`,
          )
          .run(observation.job_id, sessionId);
        const row = this.notice(observation.job_id)!;
        if (row.delivery_id) await this.options.inbox.withdrawHostInput(sessionId, row.delivery_id);
      }
      this.removeObservation(observation);
    }
  }

  private removeObservation(row: ObservationRow): void {
    this.options.database
      .prepare("DELETE FROM agent_job_observations WHERE session_id=? AND request_id=? AND tool_call_id=?")
      .run(row.session_id, row.request_id, row.tool_call_id);
  }

  private async flush(sessionId?: string): Promise<void> {
    const rows = (
      sessionId
        ? this.options.database
            .prepare("SELECT job_id FROM agent_job_notifications WHERE state='pending' AND session_id=?")
            .all(sessionId)
        : this.options.database.prepare("SELECT job_id FROM agent_job_notifications WHERE state='pending'").all()
    ) as { job_id: string }[];
    await Promise.all(rows.map(({ job_id }) => this.deliver(job_id)));
  }

  private deliver(jobId: string): Promise<void> {
    const existing = this.deliveries.get(jobId);
    if (existing) return existing;
    const delivery = this.deliverOnce(jobId)
      .catch((error: unknown) => {
        this.options.onError(error);
        if (!this.stopped && !this.retryTimer) {
          this.retryTimer = setTimeout(() => {
            this.retryTimer = undefined;
            void this.flush().catch(this.options.onError);
          }, this.options.retryDelayMs);
          this.retryTimer.unref();
        }
      })
      .finally(() => this.deliveries.delete(jobId));
    this.deliveries.set(jobId, delivery);
    return delivery;
  }

  private async deliverOnce(jobId: string): Promise<void> {
    const row = this.notice(jobId);
    if (this.stopped || !row || row.state !== "pending") return;
    if (this.options.database.prepare("SELECT 1 FROM agent_job_observations WHERE job_id=? LIMIT 1").get(jobId)) return;
    const input = JSON.parse(row.payload_json) as HostInput;
    const wake =
      row.wake === null
        ? (input.wake ?? this.options.configuration().completionDelivery === "wakeup")
        : Boolean(row.wake);
    if (row.wake === null)
      this.options.database
        .prepare("UPDATE agent_job_notifications SET wake=? WHERE job_id=?")
        .run(Number(wake), jobId);
    await this.options.inbox.acceptHostInput({ ...input, wake, mode: input.mode ?? "steer" });
    this.options.database
      .prepare("UPDATE agent_job_notifications SET state='admitted' WHERE job_id=? AND state='pending'")
      .run(jobId);
  }

  private resetWakeBudget(sessionId: string, requestId: string): void {
    this.options.database
      .prepare(
        `INSERT INTO agent_job_wake_budgets(session_id, consecutive, last_human_request) VALUES (?, 0, ?)
      ON CONFLICT(session_id) DO UPDATE SET consecutive=0, last_human_request=excluded.last_human_request
      WHERE last_human_request IS NOT excluded.last_human_request`,
      )
      .run(sessionId, requestId);
  }

  private notice(jobId: string): NoticeRow | undefined {
    return this.options.database.prepare("SELECT * FROM agent_job_notifications WHERE job_id=?").get(jobId) as
      NoticeRow | undefined;
  }
}

function isCompletion(input: AgentSessionInputBoundary["hostInput"]): boolean {
  return input?.kind === "job_completion" || input?.kind === "agent_completion";
}
