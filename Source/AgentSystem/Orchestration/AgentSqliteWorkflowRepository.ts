import type Database from "better-sqlite3";
import { z } from "zod";
import { agentSql } from "../Database/AgentSql.js";
import { AgentExecutionApprovalModeValues } from "../Safety/AgentExecutionApprovalMode.js";
import type { AgentOrchestrationDatabase } from "./AgentOrchestrationDatabase.js";
import {
  AgentWorkflowNodeStatuses,
  AgentWorkflowStatuses,
  parseAgentWorkflowDefinition,
  type AgentWorkflowCreateInput,
  type AgentWorkflowNodeRecord,
  type AgentWorkflowNodeStatus,
  type AgentWorkflowRecord,
  type AgentWorkflowRepository,
} from "./AgentWorkflowTypes.js";

interface AgentWorkflowRow {
  id: string;
  parent_session_id: string;
  parent_request_id: string;
  approval_mode: string;
  status: string;
  definition_digest: string;
  definition_json: string;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
  revision: number;
}

interface AgentWorkflowNodeRow {
  workflow_id: string;
  node_id: string;
  status: string;
  child_run_id: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
  revision: number;
}

const WorkflowStatusSchema = z.enum(AgentWorkflowStatuses);
const WorkflowNodeStatusSchema = z.enum(AgentWorkflowNodeStatuses);
const ApprovalModeSchema = z.enum(AgentExecutionApprovalModeValues);

export class AgentSqliteWorkflowRepository implements AgentWorkflowRepository {
  private readonly database: Database.Database;
  private readonly insertWorkflow: Database.Statement;
  private readonly insertNode: Database.Statement;
  private readonly selectWorkflow: Database.Statement<[string], AgentWorkflowRow>;
  private readonly listForParentStatement: Database.Statement<[string], AgentWorkflowRow>;
  private readonly listForParentRequestStatement: Database.Statement<[string, string], AgentWorkflowRow>;
  private readonly listNodes: Database.Statement<[string], AgentWorkflowNodeRow>;
  private readonly createTransaction: (input: AgentWorkflowCreateInput, createdAt: string) => AgentWorkflowRecord;

  constructor(database: AgentOrchestrationDatabase) {
    this.database = database.connection;
    this.insertWorkflow = this.database.prepare(agentSql`INSERT INTO agent_workflows (
      id, parent_session_id, parent_request_id, approval_mode, status,
      definition_digest, definition_json, created_at, updated_at
    ) VALUES (
      @id, @parent_session_id, @parent_request_id, @approval_mode, 'queued',
      @definition_digest, @definition_json, @created_at, @updated_at
    )`);
    this.insertNode = this.database.prepare(agentSql`INSERT INTO agent_workflow_nodes (
      workflow_id, node_id, status, created_at, updated_at
    ) VALUES (@workflow_id, @node_id, 'pending', @created_at, @updated_at)`);
    this.selectWorkflow = this.database.prepare(agentSql`SELECT * FROM agent_workflows WHERE id = ?`);
    this.listForParentStatement = this.database.prepare(
      agentSql`SELECT * FROM agent_workflows WHERE parent_session_id = ? ORDER BY created_at DESC`,
    );
    this.listForParentRequestStatement = this.database.prepare(
      agentSql`SELECT * FROM agent_workflows
               WHERE parent_session_id = ? AND parent_request_id = ? ORDER BY created_at DESC`,
    );
    this.listNodes = this.database.prepare(
      agentSql`SELECT * FROM agent_workflow_nodes WHERE workflow_id = ? ORDER BY rowid ASC`,
    );
    this.createTransaction = this.database.transaction((input, createdAt) => {
      this.insertWorkflow.run({
        id: input.id,
        parent_session_id: input.parentSessionId,
        parent_request_id: input.parentRequestId,
        approval_mode: input.approvalMode,
        definition_digest: input.definitionDigest,
        definition_json: JSON.stringify(input.definition),
        created_at: createdAt,
        updated_at: createdAt,
      });
      for (const node of input.definition.nodes) {
        this.insertNode.run({ workflow_id: input.id, node_id: node.id, created_at: createdAt, updated_at: createdAt });
      }
      return this.require(input.id);
    });
  }

  create(input: AgentWorkflowCreateInput, createdAt = new Date().toISOString()): AgentWorkflowRecord {
    return this.createTransaction(input, createdAt);
  }

  get(id: string): AgentWorkflowRecord | undefined {
    const row = this.selectWorkflow.get(id);
    return row ? this.fromRow(row) : undefined;
  }

  listForParent(parentSessionId: string, parentRequestId?: string): AgentWorkflowRecord[] {
    const rows = parentRequestId
      ? this.listForParentRequestStatement.all(parentSessionId, parentRequestId)
      : this.listForParentStatement.all(parentSessionId);
    return rows.map((row) => this.fromRow(row));
  }

  markRunning(id: string, updatedAt = new Date().toISOString()): AgentWorkflowRecord | undefined {
    this.database
      .prepare(
        agentSql`UPDATE agent_workflows
                        SET status = 'running', started_at = COALESCE(started_at, @updated_at),
                            completed_at = NULL, error = NULL, updated_at = @updated_at, revision = revision + 1
                        WHERE id = @id AND status IN ('queued', 'paused')`,
      )
      .run({ id, updated_at: updatedAt });
    return this.get(id);
  }

  markPaused(
    id: string,
    error: string | undefined,
    updatedAt = new Date().toISOString(),
  ): AgentWorkflowRecord | undefined {
    this.database
      .prepare(
        agentSql`UPDATE agent_workflows
                        SET status = 'paused', error = @error, completed_at = NULL,
                            updated_at = @updated_at, revision = revision + 1
                        WHERE id = @id AND status IN ('queued', 'running', 'cancelling')`,
      )
      .run({ id, error: error ?? null, updated_at: updatedAt });
    return this.get(id);
  }

  markCompleted(id: string, partial: boolean, updatedAt = new Date().toISOString()): AgentWorkflowRecord | undefined {
    this.database
      .prepare(
        agentSql`UPDATE agent_workflows
                        SET status = @status, error = NULL, completed_at = @updated_at,
                            updated_at = @updated_at, revision = revision + 1
                        WHERE id = @id AND status = 'running'`,
      )
      .run({
        id,
        status: partial ? AgentWorkflowStatuses.PartialCompleted : AgentWorkflowStatuses.Completed,
        updated_at: updatedAt,
      });
    return this.get(id);
  }

  markFailed(id: string, error: string, updatedAt = new Date().toISOString()): AgentWorkflowRecord | undefined {
    this.database
      .prepare(
        agentSql`UPDATE agent_workflows
                        SET status = 'failed', error = @error, completed_at = @updated_at,
                            updated_at = @updated_at, revision = revision + 1
                        WHERE id = @id AND status IN ('queued', 'running', 'paused')`,
      )
      .run({ id, error, updated_at: updatedAt });
    return this.get(id);
  }

  markCancelling(id: string, updatedAt = new Date().toISOString()): AgentWorkflowRecord | undefined {
    this.database
      .prepare(
        agentSql`UPDATE agent_workflows
                        SET status = 'cancelling', updated_at = @updated_at, revision = revision + 1
                        WHERE id = @id AND status IN ('queued', 'running', 'paused')`,
      )
      .run({ id, updated_at: updatedAt });
    return this.get(id);
  }

  markCancelled(id: string, updatedAt = new Date().toISOString()): AgentWorkflowRecord | undefined {
    this.database.transaction(() => {
      this.database
        .prepare(
          agentSql`UPDATE agent_workflow_nodes
                          SET status = 'cancelled', completed_at = @updated_at,
                              updated_at = @updated_at, revision = revision + 1
                          WHERE workflow_id = @id AND status IN ('pending', 'running', 'paused')`,
        )
        .run({ id, updated_at: updatedAt });
      this.database
        .prepare(
          agentSql`UPDATE agent_workflows
                          SET status = 'cancelled', completed_at = @updated_at,
                              updated_at = @updated_at, revision = revision + 1
                          WHERE id = @id AND status IN ('queued', 'running', 'paused', 'cancelling')`,
        )
        .run({ id, updated_at: updatedAt });
    })();
    return this.get(id);
  }

  markNodeRunning(
    id: string,
    nodeId: string,
    childRunId: string,
    updatedAt = new Date().toISOString(),
  ): AgentWorkflowRecord | undefined {
    this.database
      .prepare(
        agentSql`UPDATE agent_workflow_nodes
                        SET status = 'running', child_run_id = @child_run_id,
                            started_at = COALESCE(started_at, @updated_at), completed_at = NULL,
                            error = NULL, updated_at = @updated_at, revision = revision + 1
                        WHERE workflow_id = @id AND node_id = @node_id AND status IN ('pending', 'paused')`,
      )
      .run({ id, node_id: nodeId, child_run_id: childRunId, updated_at: updatedAt });
    return this.get(id);
  }

  markNodeTerminal(
    id: string,
    nodeId: string,
    status: Exclude<AgentWorkflowNodeStatus, "pending" | "running">,
    error?: string,
    updatedAt = new Date().toISOString(),
  ): AgentWorkflowRecord | undefined {
    this.database
      .prepare(
        agentSql`UPDATE agent_workflow_nodes
                        SET status = @status, error = @error, completed_at = @updated_at,
                            updated_at = @updated_at, revision = revision + 1
                        WHERE workflow_id = @id AND node_id = @node_id
                          AND status IN ('pending', 'running', 'paused')`,
      )
      .run({ id, node_id: nodeId, status, error: error ?? null, updated_at: updatedAt });
    return this.get(id);
  }

  resetForResume(id: string, updatedAt = new Date().toISOString()): AgentWorkflowRecord | undefined {
    this.database.transaction(() => {
      this.database
        .prepare(
          agentSql`UPDATE agent_workflow_nodes
                          SET status = 'pending', error = NULL, completed_at = NULL,
                              updated_at = @updated_at, revision = revision + 1
                          WHERE workflow_id = @id
                            AND status IN ('paused', 'partial_completed', 'failed', 'skipped', 'cancelled')`,
        )
        .run({ id, updated_at: updatedAt });
      this.database
        .prepare(
          agentSql`UPDATE agent_workflows
                          SET status = 'queued', error = NULL, completed_at = NULL,
                              updated_at = @updated_at, revision = revision + 1
                          WHERE id = @id AND status IN ('paused', 'partial_completed', 'failed')`,
        )
        .run({ id, updated_at: updatedAt });
    })();
    return this.get(id);
  }

  recoverInterrupted(error: string, updatedAt = new Date().toISOString()): number {
    return this.database.transaction(() => {
      this.database
        .prepare(
          agentSql`UPDATE agent_workflow_nodes
                          SET status = 'paused', error = @error,
                              updated_at = @updated_at, revision = revision + 1
                          WHERE status = 'running'`,
        )
        .run({ error, updated_at: updatedAt });
      return this.database
        .prepare(
          agentSql`UPDATE agent_workflows
                          SET status = 'paused', error = @error,
                              updated_at = @updated_at, revision = revision + 1
                          WHERE status IN ('queued', 'running', 'cancelling')`,
        )
        .run({ error, updated_at: updatedAt }).changes;
    })();
  }

  private require(id: string): AgentWorkflowRecord {
    const record = this.get(id);
    if (!record) throw new Error(`Subagent workflow does not exist after persistence: ${id}`);
    return record;
  }

  private fromRow(row: AgentWorkflowRow): AgentWorkflowRecord {
    const definition = parseAgentWorkflowDefinition(JSON.parse(row.definition_json));
    return {
      id: row.id,
      parentSessionId: row.parent_session_id,
      parentRequestId: row.parent_request_id,
      approvalMode: ApprovalModeSchema.parse(row.approval_mode),
      definitionDigest: row.definition_digest,
      definition,
      status: WorkflowStatusSchema.parse(row.status),
      nodes: this.listNodes.all(row.id).map(nodeFromRow),
      ...(row.error ? { error: row.error } : {}),
      createdAt: row.created_at,
      ...(row.started_at ? { startedAt: row.started_at } : {}),
      ...(row.completed_at ? { completedAt: row.completed_at } : {}),
      updatedAt: row.updated_at,
      revision: row.revision,
    };
  }
}

function nodeFromRow(row: AgentWorkflowNodeRow): AgentWorkflowNodeRecord {
  return {
    workflowId: row.workflow_id,
    nodeId: row.node_id,
    status: WorkflowNodeStatusSchema.parse(row.status),
    ...(row.child_run_id ? { childRunId: row.child_run_id } : {}),
    ...(row.error ? { error: row.error } : {}),
    createdAt: row.created_at,
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    updatedAt: row.updated_at,
    revision: row.revision,
  };
}
