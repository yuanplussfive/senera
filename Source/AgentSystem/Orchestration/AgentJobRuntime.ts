import type Database from "better-sqlite3";
import type { AgentExecutionResourceBroker } from "../ExecutionResources/AgentExecutionResourceBroker.js";
import type {
  AgentExecutionResourceOwner,
  AgentExecutionResourceSnapshot,
} from "../ExecutionResources/AgentExecutionResourceTypes.js";
import type { AgentOrchestrationDatabase } from "./AgentOrchestrationDatabase.js";
import type { AgentSessionManager } from "../Session/AgentSessionManager.js";
import { isTerminalResourceState } from "../ExecutionResources/AgentExecutionResourceTypes.js";
import type { AgentSessionQueuedInput } from "../Session/AgentSessionQueuedInput.js";
import { AgentJobWaiter, type AgentJobOutputOptions } from "./AgentJobWaiter.js";
import { AgentBackgroundAgentJobs, type AgentBackgroundAgentJob } from "./AgentBackgroundAgentJobs.js";
import type { AgentDelegationService } from "./AgentDelegationService.js";
import { isAgentChildRunSettled } from "./AgentChildRunTypes.js";
import type { AgentChildRunRecord } from "./AgentChildRunTypes.js";
import { AgentJobNotifications } from "./AgentJobNotifications.js";
import { AgentJobsConfigurationSchema, type AgentJobsConfiguration } from "./AgentOrchestrationConfig.js";
import type { AgentSessionInputBoundary } from "../Session/AgentSessionQueuedInput.js";

export interface AgentExecutionJobSnapshot extends AgentExecutionResourceSnapshot {
  readonly interruption?: { readonly reason: "host_restart" };
}

export type AgentJobSnapshot = AgentExecutionJobSnapshot | AgentBackgroundAgentJob;

interface JobRow {
  id: string;
  session_id: string;
  snapshot_json: string;
  delivered: number;
}

/** The process broker owns execution; SQLite owns terminal results and notice receipts. */
export class AgentJobRuntime {
  private readonly database: Database.Database;
  private readonly unobserve: () => void;
  private readonly delivering = new Map<string, Promise<void>>();
  private stopped = false;
  private ready = false;
  private readonly waiter: AgentJobWaiter;
  private readonly notifications: AgentJobNotifications;
  private agents?: AgentBackgroundAgentJobs;
  private retryTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly options: {
      database: AgentOrchestrationDatabase;
      broker: AgentExecutionResourceBroker;
      workspaceRoot: string;
      inbox: Pick<AgentSessionManager, "acceptHostInput" | "withdrawHostInput">;
      onError: (error: unknown) => void;
      retryDelayMs: number;
      pendingInputs?: (sessionId: string) => readonly AgentSessionQueuedInput[];
      configuration?: () => AgentJobsConfiguration;
      readCommittedToolCalls?: (sessionId: string) => Promise<ReadonlySet<string>>;
    },
  ) {
    this.database = options.database.connection;
    this.waiter = new AgentJobWaiter({
      maximumWaitMs: () => this.configuration().maxWaitTimeoutMs,
      defaultWaitMs: () => this.configuration().waitTimeoutMs,
      pendingInputs: options.pendingInputs,
    });
    this.notifications = new AgentJobNotifications({
      ...options,
      database: this.database,
      configuration: () => this.configuration(),
    });
    this.unobserve = options.broker.observeJobs((owner, snapshot) => this.record(owner, snapshot));
    for (const row of this.rows()) {
      const snapshot = JSON.parse(row.snapshot_json) as AgentExecutionJobSnapshot;
      if (isTerminalResourceState(snapshot.state)) continue;
      const timestamp = new Date().toISOString();
      const cursor = snapshot.cursor + 1;
      this.record(this.owner(row.session_id), {
        ...snapshot,
        state: "failed",
        pid: undefined,
        updatedAt: timestamp,
        cursor,
        events: [...snapshot.events, { kind: "state", cursor, timestamp, state: "failed", reason: "host_restart" }],
        interruption: { reason: "host_restart" },
        error: "The host restarted before this process finished. Its previous execution cannot be resumed.",
      });
    }
  }

  bindAgents(agents: AgentDelegationService): void {
    if (this.agents) throw new Error("Agent jobs are already bound.");
    this.agents = new AgentBackgroundAgentJobs(this.database, agents, this.waiter);
  }

  list(sessionId: string): AgentJobSnapshot[] {
    const live = new Map(this.options.broker.list(this.owner(sessionId)).map((item) => [item.resourceId, item]));
    const resources = this.rows(sessionId).map(
      (row) => live.get(row.id) ?? (JSON.parse(row.snapshot_json) as AgentExecutionJobSnapshot),
    );
    return [...resources, ...(this.agents?.list(sessionId) ?? [])];
  }

  output(id: string, sessionId: string, cursor = 0): AgentJobSnapshot {
    const agent = this.agents?.get(id, sessionId);
    if (agent) return agent;
    const row = this.require(id, sessionId);
    const live = this.options.broker.list(this.owner(sessionId)).some((item) => item.resourceId === id);
    if (live) return this.options.broker.inspect(id, this.owner(sessionId), cursor);
    const snapshot = JSON.parse(row.snapshot_json) as AgentExecutionJobSnapshot;
    return { ...snapshot, events: snapshot.events.filter((event) => event.cursor > cursor) };
  }

  inputAccepted(input: AgentSessionQueuedInput): void {
    this.waiter.inputAccepted(input);
    this.notifications.inputAccepted(input);
  }

  observed(boundary: AgentSessionInputBoundary): Promise<void> {
    return this.notifications.observed(boundary);
  }

  canWakeQueuedInputs(inputs: readonly AgentSessionQueuedInput[]): boolean {
    return this.notifications.canWake(inputs);
  }

  deliveryPolicy(sessionId: string) {
    const policy = this.configuration();
    return {
      ...this.notifications.deliveryPolicy(sessionId),
      wait_timeout_ms: policy.waitTimeoutMs,
      max_wait_timeout_ms: policy.maxWaitTimeoutMs,
      inline_output_bytes: policy.inlineOutputBytes,
    };
  }

  outputWaitTimeoutMs(options: AgentJobOutputOptions): number {
    return options.wait ? this.waiter.timeoutMs(options) : 0;
  }

  async readOutput(
    id: string,
    sessionId: string,
    cursor: number | undefined,
    options: AgentJobOutputOptions = {},
    observation?: { requestId?: string; toolCallId?: string },
  ) {
    this.output(id, sessionId, cursor);
    const receipt = this.notifications.begin(id, sessionId, observation?.requestId, observation?.toolCallId);
    try {
      const result = await this.waiter.read(
        id,
        sessionId,
        () => this.output(id, sessionId, cursor),
        isSettledJob,
        options,
      );
      receipt.finish(isSettledJob(result.snapshot));
      return result;
    } catch (error) {
      await receipt.failed();
      throw error;
    }
  }

  async kill(
    id: string,
    sessionId: string,
    observation?: { requestId?: string; toolCallId?: string },
  ): Promise<AgentJobSnapshot> {
    const snapshot = this.output(id, sessionId);
    const receipt = this.notifications.begin(id, sessionId, observation?.requestId, observation?.toolCallId);
    try {
      const result =
        snapshot.kind === "agent"
          ? await this.agents!.kill(id, sessionId)
          : isTerminalResourceState(snapshot.state)
            ? snapshot
            : await this.options.broker.signal(id, this.owner(sessionId), "terminate");
      receipt.finish(true);
      return result;
    } catch (error) {
      await receipt.failed();
      throw error;
    }
  }

  async deliverAgentCompletion(record: AgentChildRunRecord): Promise<void> {
    await this.notifications.publish(record.childRequestId, {
      sessionId: record.parentSessionId,
      deliveryId: `agent-completion:${record.id}:${record.childRequestId}`,
      sourceId: record.childSessionId,
      kind: "agent_completion",
      content: JSON.stringify({
        agent_id: record.childSessionId,
        job_id: record.childRequestId,
        status: record.status,
        ...this.inlineResult(record.finalAnswer, record.error),
      }),
    });
  }

  async replay(): Promise<void> {
    this.ready = true;
    await this.notifications.replay();
    for (const row of this.rows()) if (!row.delivered) this.deliver(row);
    await Promise.all(this.delivering.values());
  }

  removeOwnerSession(sessionId: string): void {
    this.agents?.removeOwnerSession(sessionId);
    this.notifications.removeOwnerSession(sessionId);
    this.database.prepare("DELETE FROM agent_jobs WHERE session_id = ?").run(sessionId);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.unobserve();
    this.waiter.stop();
    this.agents?.stop();
    clearTimeout(this.retryTimer);
    await Promise.allSettled(this.delivering.values());
    await this.notifications.stop();
  }

  private record(owner: AgentExecutionResourceOwner, snapshot: AgentExecutionJobSnapshot): void {
    if (!owner.sessionId || this.stopped) return;
    const previous = this.database
      .prepare("SELECT snapshot_json FROM agent_jobs WHERE id = ?")
      .get(snapshot.resourceId) as Pick<JobRow, "snapshot_json"> | undefined;
    if (previous?.snapshot_json === JSON.stringify(snapshot)) return;
    this.database
      .prepare(
        `INSERT INTO agent_jobs(id, session_id, snapshot_json, delivered)
      VALUES (?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET snapshot_json = excluded.snapshot_json`,
      )
      .run(snapshot.resourceId, owner.sessionId, JSON.stringify(snapshot));
    this.waiter.changed(snapshot.resourceId);
    if (isTerminalResourceState(snapshot.state)) this.deliver(this.require(snapshot.resourceId, owner.sessionId));
  }

  private deliver(row: JobRow): void {
    if (!this.ready || this.stopped || row.delivered || this.delivering.has(row.id)) return;
    const snapshot = JSON.parse(row.snapshot_json) as AgentExecutionJobSnapshot;
    if (!isTerminalResourceState(snapshot.state)) return;
    const delivery = this.notifications
      .publish(row.id, {
        sessionId: row.session_id,
        deliveryId: `job-completion:${row.id}`,
        sourceId: row.id,
        kind: "job_completion",
        ...(snapshot.interruption ? { wake: false } : {}),
        content: JSON.stringify({
          job_id: row.id,
          state: snapshot.state,
          exit_code: snapshot.exitCode,
          ...(snapshot.interruption ? { interruption: snapshot.interruption } : {}),
          ...this.inlineResult(
            snapshot.truncated
              ? undefined
              : snapshot.events.flatMap((event) => (event.kind === "output" ? [event.text] : [])).join(""),
            snapshot.error,
          ),
        }),
      })
      .then(() => {
        // The notification coordinator now owns durable delivery or observation.
        this.database.prepare("UPDATE agent_jobs SET delivered = 1 WHERE id = ?").run(row.id);
      })
      .catch((error: unknown) => {
        this.options.onError(error);
        if (!this.stopped && !this.retryTimer) {
          this.retryTimer = setTimeout(() => {
            this.retryTimer = undefined;
            void this.replay().catch(this.options.onError);
          }, this.options.retryDelayMs);
          this.retryTimer.unref();
        }
      })
      .finally(() => {
        this.delivering.delete(row.id);
      });
    this.delivering.set(row.id, delivery);
  }

  private configuration(): AgentJobsConfiguration {
    return this.options.configuration?.() ?? AgentJobsConfigurationSchema.parse({});
  }

  private inlineResult(result: string | undefined, error?: string) {
    const limit = this.configuration().inlineOutputBytes;
    const content = { ...(result === undefined ? {} : { result }), ...(error === undefined ? {} : { error }) };
    return (result !== undefined || error !== undefined) &&
      limit > 0 &&
      Buffer.byteLength(JSON.stringify(content), "utf8") <= limit
      ? content
      : { instruction: "Use job_output to inspect the result if needed." };
  }

  private rows(sessionId?: string): JobRow[] {
    return (
      sessionId
        ? this.database.prepare("SELECT * FROM agent_jobs WHERE session_id = ? ORDER BY rowid").all(sessionId)
        : this.database.prepare("SELECT * FROM agent_jobs ORDER BY rowid").all()
    ) as JobRow[];
  }
  private require(id: string, sessionId: string): JobRow {
    const row = this.database.prepare("SELECT * FROM agent_jobs WHERE id = ? AND session_id = ?").get(id, sessionId) as
      JobRow | undefined;
    if (!row) throw new Error("Background job was not found in this session.");
    return row;
  }
  private owner(sessionId: string): AgentExecutionResourceOwner {
    return { workspaceRoot: this.options.workspaceRoot, sessionId };
  }
}

function isSettledJob(snapshot: AgentJobSnapshot): boolean {
  return snapshot.kind === "agent" ? isAgentChildRunSettled(snapshot.status) : isTerminalResourceState(snapshot.state);
}
