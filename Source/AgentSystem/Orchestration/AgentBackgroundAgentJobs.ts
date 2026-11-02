import type Database from "better-sqlite3";
import type { AgentDelegationService } from "./AgentDelegationService.js";
import {
  isAgentChildRunSettled,
  type AgentChildRunRecord,
  type AgentChildRunProgressProjection,
} from "./AgentChildRunTypes.js";
import type { AgentJobWaiter } from "./AgentJobWaiter.js";
import { projectAgentChildRunProgress } from "./AgentChildRunProjection.js";

export interface AgentBackgroundAgentJob extends Pick<
  AgentChildRunRecord,
  "id" | "childRequestId" | "childSessionId" | "parentSessionId" | "status" | "finalAnswer" | "error"
> {
  readonly kind: "agent";
  readonly description?: string;
  readonly progress?: AgentChildRunProgressProjection;
}

/** An activation is a job; the persistent child session remains its messaging identity. */
export class AgentBackgroundAgentJobs {
  private readonly unobserve: () => void;

  constructor(
    private readonly database: Database.Database,
    private readonly agents: AgentDelegationService,
    waiter: AgentJobWaiter,
  ) {
    this.unobserve = agents.observeActivations((record) => {
      const snapshot: AgentBackgroundAgentJob = {
        kind: "agent",
        id: record.id,
        childRequestId: record.childRequestId,
        childSessionId: record.childSessionId,
        parentSessionId: record.parentSessionId,
        status: record.status,
        description: typeof record.launchContract.label === "string" ? record.launchContract.label : undefined,
        progress: projectAgentChildRunProgress(record),
        finalAnswer: record.finalAnswer,
        error: record.error,
      };
      database
        .prepare(
          `INSERT INTO agent_job_activations(id, parent_session_id, snapshot_json) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET snapshot_json = excluded.snapshot_json`,
        )
        .run(record.childRequestId, record.parentSessionId, JSON.stringify(snapshot));
      waiter.changed(record.childRequestId);
    });
  }

  stop(): void {
    this.unobserve();
  }

  list(sessionId: string): AgentBackgroundAgentJob[] {
    return (
      this.database
        .prepare("SELECT snapshot_json FROM agent_job_activations WHERE parent_session_id = ? ORDER BY rowid")
        .all(sessionId) as { snapshot_json: string }[]
    ).map((row) => JSON.parse(row.snapshot_json) as AgentBackgroundAgentJob);
  }

  get(id: string, sessionId: string): AgentBackgroundAgentJob | undefined {
    const row = this.database
      .prepare("SELECT snapshot_json FROM agent_job_activations WHERE id = ? AND parent_session_id = ?")
      .get(id, sessionId) as { snapshot_json: string } | undefined;
    return row ? (JSON.parse(row.snapshot_json) as AgentBackgroundAgentJob) : undefined;
  }

  async kill(id: string, sessionId: string) {
    const record = this.require(id, sessionId);
    const current = this.agents.get(record.id, sessionId);
    // An old job never interrupts a newer activation of the same agent.
    if (current?.childRequestId === id && !isAgentChildRunSettled(current.status))
      await this.agents.cancel(record.id, sessionId);
    return this.require(id, sessionId);
  }

  removeOwnerSession(sessionId: string): void {
    this.database.prepare("DELETE FROM agent_job_activations WHERE parent_session_id = ?").run(sessionId);
  }

  private require(id: string, sessionId: string): AgentBackgroundAgentJob {
    const record = this.get(id, sessionId);
    if (!record) throw new Error("Agent job was not found in this session.");
    return record;
  }
}
