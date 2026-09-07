import type Database from "better-sqlite3";
import { z } from "zod";
import { AgentExecutionApprovalModeValues } from "../Safety/AgentExecutionApprovalMode.js";
import { AgentRunContextModes } from "./AgentRunDispatchPort.js";
import {
  AgentChildRunModelSelectionSources,
  AgentChildRunMessageDirections,
  AgentChildRunMessageKinds,
  AgentChildRunCheckpointSources,
  AgentChildRunStatuses,
  AgentChildRunJoinModes,
  AgentChildWorkspaceAccessModes,
  type AgentChildRunModelSelectionSource,
  type AgentChildRunCreateInput,
  type AgentChildRunRecord,
  type AgentChildRunRepository,
  type AgentChildRunStatus,
  type AgentChildRunExecutionContract,
  type AgentChildRunCheckpoint,
  type AgentChildRunSnapshot,
  type AgentChildRunCompletionInput,
  type AgentChildRunMessage,
  type AgentChildRunMessageDirection,
  type AgentChildRunMessageKind,
  type AgentChildRunJoinGroup,
} from "./AgentChildRunTypes.js";
import {
  prepareAgentChildRunSqlStatements,
  type AgentChildRunRow,
  type AgentChildRunSqlStatements,
} from "./AgentChildRunSqlStatements.js";
import type { AgentOrchestrationDatabase } from "./AgentOrchestrationDatabase.js";
import {
  AgentModelUsageSources,
  type AgentModelUsageSource,
  type AgentModelUsageValue,
} from "../ModelEndpoints/AgentModelUsage.js";

export class AgentSqliteChildRunRepository implements AgentChildRunRepository {
  private readonly database: Database.Database;
  private readonly statements: AgentChildRunSqlStatements;

  constructor(database: AgentOrchestrationDatabase) {
    this.database = database.connection;
    this.statements = prepareAgentChildRunSqlStatements(this.database);
  }

  create(input: AgentChildRunCreateInput, createdAt = new Date().toISOString()): AgentChildRunRecord {
    this.statements.insert.run({
      id: input.id,
      owner_run_id: input.ownerRunId ?? input.parentRequestId,
      node_id: input.nodeId ?? input.id,
      join_group_json: input.joinGroup ? JSON.stringify(input.joinGroup) : null,
      parent_session_id: input.parentSessionId,
      parent_request_id: input.parentRequestId,
      child_session_id: input.childSessionId,
      child_request_id: input.childRequestId,
      agent_name: input.agentName,
      task: input.task,
      context_mode: input.contextMode,
      approval_mode: input.approvalMode,
      model_provider_id: input.modelProviderId ?? null,
      model_selection_source: input.modelSelectionSource ?? null,
      selected_skills_json: JSON.stringify(input.selectedSkills),
      configuration_revision: input.configurationRevision ?? null,
      execution_contract_json: JSON.stringify(input.executionContract),
      status: AgentChildRunStatuses.Queued,
      launch_contract_digest: input.launchContractDigest,
      launch_contract_json: JSON.stringify(input.launchContract),
      allowed_tool_names_json: JSON.stringify(input.allowedToolNames),
      created_at: createdAt,
      updated_at: createdAt,
    });
    return this.require(input.id);
  }

  get(id: string): AgentChildRunRecord | undefined {
    const row = this.statements.select.get(id);
    return row ? this.fromRow(row) : undefined;
  }

  getByChildSession(childSessionId: string): AgentChildRunRecord | undefined {
    const row = this.statements.selectByChildSession.get(childSessionId);
    return row ? this.fromRow(row) : undefined;
  }

  getByOwnerNode(ownerRunId: string, nodeId: string): AgentChildRunRecord | undefined {
    const row = this.statements.selectByOwnerNode.get(ownerRunId, nodeId);
    return row ? this.fromRow(row) : undefined;
  }

  listForParent(parentSessionId: string, parentRequestId?: string): AgentChildRunRecord[] {
    const rows = parentRequestId
      ? this.statements.listForParentRequest.all(parentSessionId, parentRequestId)
      : this.statements.listForParent.all(parentSessionId);
    return rows.map((row) => this.fromRow(row));
  }

  listForOwner(ownerRunId: string): AgentChildRunRecord[] {
    return this.statements.listForOwner.all(ownerRunId).map((row) => this.fromRow(row));
  }

  listForJoinGroup(joinGroupId: string): AgentChildRunRecord[] {
    const normalized = joinGroupId.trim();
    if (!normalized) throw new Error("Join group id must be a non-empty string.");
    return this.statements.listForJoinGroup.all(normalized).map((row) => this.fromRow(row));
  }

  listActive(): AgentChildRunRecord[] {
    return this.statements.listActive.all().map((row) => this.fromRow(row));
  }

  listAll(): AgentChildRunRecord[] {
    return this.statements.listAll.all().map((row) => this.fromRow(row));
  }

  markRunning(id: string, startedAt = new Date().toISOString()): AgentChildRunRecord | undefined {
    this.statements.markRunning.run({ id, started_at: startedAt });
    return this.get(id);
  }

  markWrappingUp(id: string, updatedAt = new Date().toISOString()): AgentChildRunRecord | undefined {
    this.statements.markWrappingUp.run({ id, updated_at: updatedAt });
    return this.get(id);
  }

  markCancelling(id: string, updatedAt = new Date().toISOString()): AgentChildRunRecord | undefined {
    this.statements.markCancelling.run({ id, updated_at: updatedAt });
    return this.get(id);
  }

  markAwaitingSupervisor(id: string, updatedAt = new Date().toISOString()): AgentChildRunRecord | undefined {
    this.statements.markAwaitingSupervisor.run({ id, updated_at: updatedAt });
    return this.get(id);
  }

  markResumed(
    id: string,
    childRequestId: string,
    updatedAt = new Date().toISOString(),
  ): AgentChildRunRecord | undefined {
    this.statements.markResumed.run({ id, child_request_id: childRequestId, updated_at: updatedAt });
    return this.get(id);
  }

  recordSnapshot(
    id: string,
    snapshot: AgentChildRunSnapshot,
    checkpoint?: AgentChildRunCheckpoint,
    updatedAt = new Date().toISOString(),
  ): AgentChildRunRecord | undefined {
    this.statements.recordSnapshot.run({
      id,
      snapshot_json: JSON.stringify(snapshot),
      checkpoint_json: checkpoint ? JSON.stringify(checkpoint) : null,
      updated_at: updatedAt,
    });
    return this.get(id);
  }

  recordSupervisorCheckpoint(
    id: string,
    result: { readonly finalAnswer: string; readonly usage?: AgentModelUsageValue },
    updatedAt = new Date().toISOString(),
  ): AgentChildRunRecord | undefined {
    const checkpoint: AgentChildRunCheckpoint = {
      version: 1,
      capturedAt: updatedAt,
      source: AgentChildRunCheckpointSources.SupervisorWait,
      ...(result.finalAnswer.trim() ? { content: result.finalAnswer } : {}),
      complete: true,
    };
    this.statements.recordSupervisorCheckpoint.run({
      id,
      checkpoint_json: JSON.stringify(checkpoint),
      usage_json: result.usage ? JSON.stringify(result.usage) : null,
      updated_at: updatedAt,
    });
    return this.get(id);
  }

  appendMessage(
    message: Omit<AgentChildRunMessage, "createdAt">,
    createdAt = new Date().toISOString(),
  ): AgentChildRunMessage {
    this.statements.insertMessage.run({
      id: message.id,
      child_run_id: message.childRunId,
      direction: message.direction,
      kind: message.kind,
      content: message.content,
      created_at: createdAt,
    });
    return { ...message, createdAt };
  }

  markCompleted(
    id: string,
    result: AgentChildRunCompletionInput,
    completedAt = new Date().toISOString(),
  ): AgentChildRunRecord | undefined {
    this.statements.markCompleted.run({
      id,
      final_answer: result.finalAnswer,
      usage_json: result.usage ? JSON.stringify(result.usage) : null,
      completed_at: completedAt,
    });
    return this.get(id);
  }

  markPartialCompleted(
    id: string,
    result: AgentChildRunCompletionInput,
    completedAt = new Date().toISOString(),
  ): AgentChildRunRecord | undefined {
    this.statements.markPartialCompleted.run({
      id,
      final_answer: result.finalAnswer,
      usage_json: result.usage ? JSON.stringify(result.usage) : null,
      completed_at: completedAt,
    });
    return this.get(id);
  }

  markInterrupted(
    id: string,
    error: string,
    completedAt = new Date().toISOString(),
    partialAnswer?: string,
  ): AgentChildRunRecord | undefined {
    this.statements.markInterrupted.run({
      id,
      error,
      completed_at: completedAt,
      final_answer: partialAnswer?.trim() || null,
    });
    return this.get(id);
  }

  markFailed(id: string, error: string, completedAt = new Date().toISOString()): AgentChildRunRecord | undefined {
    this.statements.markFailed.run({ id, error, completed_at: completedAt });
    return this.get(id);
  }

  markCancelled(
    id: string,
    completedAt = new Date().toISOString(),
    partialAnswer?: string,
  ): AgentChildRunRecord | undefined {
    this.statements.markCancelled.run({
      id,
      completed_at: completedAt,
      final_answer: partialAnswer?.trim() || null,
    });
    return this.get(id);
  }

  markTimedOut(
    id: string,
    error: string,
    completedAt = new Date().toISOString(),
    partialAnswer?: string,
  ): AgentChildRunRecord | undefined {
    this.statements.markTimedOut.run({
      id,
      error,
      completed_at: completedAt,
      final_answer: partialAnswer?.trim() || null,
    });
    return this.get(id);
  }

  recoverInterrupted(error: string, recoveredAt = new Date().toISOString()): number {
    return this.statements.recoverInterrupted.run({ error, recovered_at: recoveredAt }).changes;
  }

  private require(id: string): AgentChildRunRecord {
    const record = this.get(id);
    if (!record) throw new Error(`Child run does not exist after persistence: ${id}`);
    return record;
  }

  private fromRow(row: AgentChildRunRow): AgentChildRunRecord {
    return childRunFromRow(
      row,
      this.statements.listMessages.all(row.id).map((message) => ({
        id: message.id,
        childRunId: message.child_run_id,
        direction: readMessageDirection(message.direction),
        kind: readMessageKind(message.kind),
        content: message.content,
        createdAt: message.created_at,
      })),
    );
  }
}

function childRunFromRow(row: AgentChildRunRow, messages: readonly AgentChildRunMessage[]): AgentChildRunRecord {
  return {
    id: row.id,
    ownerRunId: row.owner_run_id,
    nodeId: row.node_id,
    ...(row.join_group_json !== null
      ? { joinGroup: readJoinGroup(row.join_group_json, `child run ${row.id} join group`) }
      : {}),
    parentSessionId: row.parent_session_id,
    parentRequestId: row.parent_request_id,
    childSessionId: row.child_session_id,
    childRequestId: row.child_request_id,
    agentName: row.agent_name,
    task: row.task,
    contextMode: readContextMode(row.context_mode),
    approvalMode: readApprovalMode(row.approval_mode),
    ...(row.model_provider_id ? { modelProviderId: row.model_provider_id } : {}),
    ...(row.model_selection_source
      ? { modelSelectionSource: readModelSelectionSource(row.model_selection_source) }
      : {}),
    selectedSkills: readSelectedSkills(row.selected_skills_json, `child run ${row.id} selected Skills`),
    ...(row.configuration_revision !== null ? { configurationRevision: row.configuration_revision } : {}),
    executionContract: readExecutionContract(row.execution_contract_json, `child run ${row.id} execution contract`),
    messages,
    status: readStatus(row.status),
    launchContractDigest: row.launch_contract_digest,
    launchContract: readObjectJson(row.launch_contract_json, `child run ${row.id} launch contract`),
    allowedToolNames: readStringArrayJson(row.allowed_tool_names_json, `child run ${row.id} allowed tools`),
    ...(row.snapshot_json !== null
      ? { snapshot: readSnapshot(row.snapshot_json, `child run ${row.id} snapshot`) }
      : {}),
    ...(row.checkpoint_json !== null
      ? { checkpoint: readCheckpoint(row.checkpoint_json, `child run ${row.id} checkpoint`) }
      : {}),
    ...(row.final_answer !== null ? { finalAnswer: row.final_answer } : {}),
    ...(row.usage_json !== null ? { usage: readModelUsage(row.usage_json, `child run ${row.id} usage`) } : {}),
    ...(row.error !== null ? { error: row.error } : {}),
    createdAt: row.created_at,
    ...(row.started_at !== null ? { startedAt: row.started_at } : {}),
    ...(row.completed_at !== null ? { completedAt: row.completed_at } : {}),
    updatedAt: row.updated_at,
    revision: row.revision,
  };
}

const AgentChildRunJoinGroupSchema = z
  .object({
    id: z.string().trim().min(1),
    mode: z.enum([AgentChildRunJoinModes.Any, AgentChildRunJoinModes.All]),
    expectedCount: z.number().int().positive(),
  })
  .strict();

function readJoinGroup(value: string, label: string): AgentChildRunJoinGroup {
  try {
    return AgentChildRunJoinGroupSchema.parse(JSON.parse(value));
  } catch (error) {
    throw new Error(`Invalid ${label}.`, { cause: error });
  }
}

const AgentChildRunExecutionContractSchema = z
  .object({
    version: z.literal(5),
    workspaceAccess: z.enum(AgentChildWorkspaceAccessModes),
    promptLayer: z.object({ mode: z.enum(["append", "replace"]), content: z.string() }).strict(),
    modelCandidateProviderIds: z.array(z.string().min(1)),
    thinkingLevel: z.enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
    inheritProjectContext: z.boolean(),
    capabilityCeiling: z
      .object({
        version: z.literal(2),
        allowedTools: z.array(z.string().min(1)),
        allowedAgents: z.array(z.string().min(1)),
        denyExtensions: z.boolean(),
        sources: z.array(z.string().min(1)),
      })
      .strict()
      .optional(),
    deadline: z
      .object({
        softTimeoutMs: z.number().int().min(1),
        wrapUpTimeoutMs: z.number().int().min(1),
        snapshotIntervalMs: z.number().int().min(1),
        activityExtension: z
          .object({
            recentActivityWindowMs: z.number().int().min(1),
            stepMs: z.number().int().min(1),
            maximumMs: z.number().int().min(0),
          })
          .strict(),
      })
      .strict(),
    control: z
      .object({
        todo: z
          .object({
            required: z.boolean(),
            minimumItems: z.number().int().min(1),
          })
          .strict(),
        budget: z
          .object({
            maxModelTurns: z.number().int().min(1),
            maxToolCalls: z.number().int().min(1),
            noProgressTurns: z.number().int().min(1),
            noProgressTimeoutMs: z.number().int().min(1),
          })
          .strict(),
      })
      .strict()
      .optional(),
  })
  .strict();

const AgentChildRunSnapshotSchema = z
  .object({
    version: z.literal(1),
    capturedAt: z.iso.datetime(),
    lastActivityAt: z.iso.datetime(),
    lastModelOutputAt: z.iso.datetime().optional(),
    modelOutputCharacters: z.number().int().min(0),
    assistantTurns: z.number().int().min(0),
    toolCalls: z
      .object({
        planned: z.number().int().min(0),
        started: z.number().int().min(0),
        completed: z.number().int().min(0),
        failed: z.number().int().min(0),
      })
      .strict(),
    activeTools: z.array(z.string().min(1)),
    artifactUris: z.array(z.string().min(1)),
    control: z
      .object({
        todo: z
          .object({
            planObserved: z.boolean(),
            counts: z
              .object({
                total: z.number().int().min(0),
                pending: z.number().int().min(0),
                inProgress: z.number().int().min(0),
                completed: z.number().int().min(0),
                cancelled: z.number().int().min(0),
              })
              .strict(),
            items: z
              .array(
                z
                  .object({
                    content: z.string().min(1),
                    status: z.string().min(1),
                  })
                  .strict(),
              )
              .optional(),
          })
          .strict(),
        budget: z
          .object({
            modelTurns: z.number().int().min(0),
            toolCalls: z.number().int().min(0),
            noProgressTurns: z.number().int().min(0),
            lastMeaningfulProgressAt: z.iso.datetime().optional(),
            limitReason: z.enum(["model_turn_budget", "tool_call_budget", "no_progress"]).optional(),
          })
          .strict(),
      })
      .strict()
      .optional(),
    deadline: z
      .object({
        softDeadlineAt: z.iso.datetime(),
        grantedExtensionMs: z.number().int().min(0),
        hardDeadlineAt: z.iso.datetime().optional(),
      })
      .strict(),
  })
  .strict();

const AgentChildRunCheckpointSchema = z
  .object({
    version: z.literal(1),
    capturedAt: z.iso.datetime(),
    source: z.enum(AgentChildRunCheckpointSources),
    content: z.string().optional(),
    complete: z.boolean(),
  })
  .strict();

function readExecutionContract(value: string, label: string): AgentChildRunExecutionContract {
  const parsed = AgentChildRunExecutionContractSchema.safeParse(JSON.parse(value));
  if (!parsed.success) throw new Error(`${label} is invalid: ${parsed.error.message}`);
  return parsed.data;
}

function readSnapshot(value: string, label: string): AgentChildRunSnapshot {
  const parsed = AgentChildRunSnapshotSchema.safeParse(JSON.parse(value));
  if (!parsed.success) throw new Error(`${label} is invalid: ${parsed.error.message}`);
  return parsed.data;
}

function readCheckpoint(value: string, label: string): AgentChildRunCheckpoint {
  const parsed = AgentChildRunCheckpointSchema.safeParse(JSON.parse(value));
  if (!parsed.success) throw new Error(`${label} is invalid: ${parsed.error.message}`);
  return parsed.data;
}

function readMessageDirection(value: string): AgentChildRunMessageDirection {
  const direction = Object.values(AgentChildRunMessageDirections).find((candidate) => candidate === value);
  if (!direction) throw new Error(`Stored child run message direction is invalid: ${value}`);
  return direction;
}

function readMessageKind(value: string): AgentChildRunMessageKind {
  const kind = Object.values(AgentChildRunMessageKinds).find((candidate) => candidate === value);
  if (!kind) throw new Error(`Stored child run message kind is invalid: ${value}`);
  return kind;
}

function readContextMode(value: string) {
  if (value === AgentRunContextModes.Fresh || value === AgentRunContextModes.Fork) return value;
  throw new Error(`Stored child run context mode is invalid: ${value}`);
}

function readApprovalMode(value: string) {
  const mode = AgentExecutionApprovalModeValues.find((candidate) => candidate === value);
  if (!mode) throw new Error(`Stored child run approval mode is invalid: ${value}`);
  return mode;
}

function readStatus(value: string): AgentChildRunStatus {
  const status = Object.values(AgentChildRunStatuses).find((candidate) => candidate === value);
  if (!status) throw new Error(`Stored child run status is invalid: ${value}`);
  return status;
}

function readModelSelectionSource(value: string): AgentChildRunModelSelectionSource {
  const source = Object.values(AgentChildRunModelSelectionSources).find((candidate) => candidate === value);
  if (!source) throw new Error(`Stored child run model selection source is invalid: ${value}`);
  return source;
}

function readSelectedSkills(value: string, label: string): Array<{ name: string; revision: string }> {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (entry) =>
        !entry ||
        typeof entry !== "object" ||
        Array.isArray(entry) ||
        typeof (entry as Record<string, unknown>).name !== "string" ||
        typeof (entry as Record<string, unknown>).revision !== "string",
    )
  ) {
    throw new Error(`${label} must be an array of name and revision records.`);
  }
  return parsed as Array<{ name: string; revision: string }>;
}

function readObjectJson(value: string, label: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} must be an object.`);
  return parsed as Record<string, unknown>;
}

function readStringArrayJson(value: string, label: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new Error(`${label} must be a string array.`);
  }
  return parsed;
}

function readModelUsage(value: string, label: string): AgentModelUsageValue {
  const parsed = readObjectJson(value, label);
  const source = Object.values(AgentModelUsageSources).find((candidate) => candidate === parsed.source) as
    AgentModelUsageSource | undefined;
  if (!source) throw new Error(`${label} has an invalid source.`);
  return { ...parsed, source } as AgentModelUsageValue;
}
