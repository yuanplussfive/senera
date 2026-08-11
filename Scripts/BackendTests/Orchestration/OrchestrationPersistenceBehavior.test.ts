import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { ScheduledTask } from "@amaster.ai/pi-task-scheduler";
import Database from "better-sqlite3";
import { AgentOrchestrationDatabase } from "../../../Source/AgentSystem/Orchestration/AgentOrchestrationDatabase.js";
import { AgentSqliteChildRunRepository } from "../../../Source/AgentSystem/Orchestration/AgentSqliteChildRunRepository.js";
import { AgentSqliteScheduledTaskStore } from "../../../Source/AgentSystem/Orchestration/AgentSqliteScheduledTaskStore.js";
import { AgentSqliteSchedulerLock } from "../../../Source/AgentSystem/Orchestration/AgentSqliteSchedulerLock.js";
import { AgentSqliteWorkflowRepository } from "../../../Source/AgentSystem/Orchestration/AgentSqliteWorkflowRepository.js";
import {
  AgentChildRunModelSelectionSources,
  AgentChildRunStatuses,
  AgentChildWorkspaceAccessModes,
  type AgentChildRunCreateInput,
} from "../../../Source/AgentSystem/Orchestration/AgentChildRunTypes.js";
import { AgentRunContextModes } from "../../../Source/AgentSystem/Orchestration/AgentRunDispatchPort.js";
import { AgentScheduledTaskToolPolicyProtocol } from "../../../Source/AgentSystem/Orchestration/AgentOrchestrationProtocols.js";
import {
  AgentWorkflowNodeStatuses,
  AgentWorkflowStatuses,
} from "../../../Source/AgentSystem/Orchestration/AgentWorkflowTypes.js";
import { AgentExecutionApprovalModes } from "../../../Source/AgentSystem/Safety/AgentExecutionApprovalMode.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("orchestration SQLite persistence", () => {
  test("persists child-run lifecycle and recovers interrupted work", () => {
    const database = openDatabase();
    const repository = new AgentSqliteChildRunRepository(database);
    const created = repository.create({
      id: "child-1",
      parentSessionId: "parent-session",
      parentRequestId: "parent-request",
      childSessionId: "child-session",
      childRequestId: "child-request",
      agentName: "reviewer",
      task: "Review the implementation.",
      contextMode: AgentRunContextModes.Fork,
      approvalMode: AgentExecutionApprovalModes.Agent,
      modelProviderId: "main",
      modelSelectionSource: AgentChildRunModelSelectionSources.ExtensionDefault,
      selectedSkills: [{ name: "workspace-investigation", revision: "revision-a" }],
      configurationRevision: 17,
      launchContractDigest: "digest",
      launchContract: { version: 2 },
      allowedToolNames: ["ShellCommandTool"],
      executionContract: {
        version: 5,
        workspaceAccess: AgentChildWorkspaceAccessModes.ReadWrite,
        promptLayer: { mode: "replace", content: "Review changes." },
        modelCandidateProviderIds: ["main"],
        inheritProjectContext: true,
        deadline: testDeadlinePolicy(),
      },
    });

    expect(created.status).toBe(AgentChildRunStatuses.Queued);
    expect(repository.markRunning(created.id)?.status).toBe(AgentChildRunStatuses.Running);
    repository.appendMessage({
      id: "message-1",
      childRunId: created.id,
      direction: "child_to_parent",
      kind: "decision",
      content: "Choose a migration strategy.",
    });
    expect(repository.markAwaitingSupervisor(created.id)?.status).toBe(AgentChildRunStatuses.AwaitingSupervisor);
    expect(repository.recordSupervisorCheckpoint(created.id, { finalAnswer: "checkpoint" })).toMatchObject({
      checkpoint: {
        source: "supervisor_wait",
        content: "checkpoint",
        complete: true,
      },
      executionContract: expect.objectContaining({
        version: 5,
        workspaceAccess: AgentChildWorkspaceAccessModes.ReadWrite,
        deadline: expect.objectContaining({ softTimeoutMs: 10_000 }),
      }),
      messages: [expect.objectContaining({ id: "message-1", kind: "decision" })],
    });
    expect(repository.get(created.id)).not.toHaveProperty("finalAnswer");
    expect(repository.markResumed(created.id, "child-request-2")?.status).toBe(AgentChildRunStatuses.Queued);
    expect(repository.markRunning(created.id)?.status).toBe(AgentChildRunStatuses.Running);
    expect(repository.listForParent("parent-session", "parent-request")).toHaveLength(1);
    expect(repository.recoverInterrupted("runtime restarted")).toBe(1);
    expect(repository.get(created.id)).toMatchObject({
      status: AgentChildRunStatuses.Interrupted,
      error: "runtime restarted",
      finalAnswer: "checkpoint",
      allowedToolNames: ["ShellCommandTool"],
      modelSelectionSource: AgentChildRunModelSelectionSources.ExtensionDefault,
      selectedSkills: [{ name: "workspace-investigation", revision: "revision-a" }],
      configurationRevision: 17,
    });
    database.close();
  });

  test("preserves an awaiting-supervisor child run across runtime restart recovery", () => {
    const databasePath = createDatabasePath();
    let database = new AgentOrchestrationDatabase(databasePath);
    let repository = new AgentSqliteChildRunRepository(database);
    const created = repository.create(childRunInput("child-waiting"));
    repository.markRunning(created.id);
    repository.appendMessage({
      id: "message-waiting",
      childRunId: created.id,
      direction: "child_to_parent",
      kind: "decision",
      content: "Select the migration strategy.",
    });
    repository.markAwaitingSupervisor(created.id);
    database.close();

    database = new AgentOrchestrationDatabase(databasePath);
    repository = new AgentSqliteChildRunRepository(database);
    try {
      expect(repository.recoverInterrupted("runtime restarted")).toBe(0);
      const recovered = repository.get(created.id);
      expect(recovered).toMatchObject({
        status: AgentChildRunStatuses.AwaitingSupervisor,
        messages: [expect.objectContaining({ id: "message-waiting", kind: "decision" })],
      });
      expect(recovered).not.toHaveProperty("error");
    } finally {
      database.close();
    }
  });

  test("explicitly requeues interrupted, failed, and cancelled child runs", () => {
    const database = openDatabase();
    const repository = new AgentSqliteChildRunRepository(database);
    const statuses = [
      {
        id: "child-resume-interrupted",
        terminate: () =>
          repository.markInterrupted("child-resume-interrupted", "provider interrupted", undefined, "partial"),
      },
      {
        id: "child-resume-failed",
        terminate: () => repository.markFailed("child-resume-failed", "provider failed"),
      },
      {
        id: "child-resume-cancelled",
        terminate: () => repository.markCancelled("child-resume-cancelled"),
      },
    ];

    for (const candidate of statuses) {
      repository.create(childRunInput(candidate.id));
      repository.markRunning(candidate.id);
      candidate.terminate();
      const resumed = repository.markResumed(candidate.id, `request-${candidate.id}`);
      expect(resumed).toMatchObject({
        id: candidate.id,
        status: AgentChildRunStatuses.Queued,
        childRequestId: `request-${candidate.id}`,
      });
      expect(resumed).not.toHaveProperty("error");
      expect(resumed).not.toHaveProperty("finalAnswer");
    }
    database.close();
  });

  test("pauses an active workflow on restart without invalidating completed nodes", () => {
    const databasePath = createDatabasePath();
    let database: AgentOrchestrationDatabase | undefined = new AgentOrchestrationDatabase(databasePath);
    try {
      let repository = new AgentSqliteWorkflowRepository(database);
      const childRuns = new AgentSqliteChildRunRepository(database);
      childRuns.create(childRunInput("child-completed"));
      childRuns.create(childRunInput("child-active"));
      const created = repository.create({
        id: "workflow-recovery",
        parentSessionId: "parent-session",
        parentRequestId: "parent-request",
        approvalMode: AgentExecutionApprovalModes.Agent,
        definitionDigest: "workflow-recovery-digest",
        definition: {
          version: 1,
          failurePolicy: "fail_fast",
          nodes: [
            {
              id: "completed-node",
              agent: "reviewer",
              task: "Collect evidence.",
              dependsOn: [],
              handoff: "append_dependency_results",
              workspaceAccess: AgentChildWorkspaceAccessModes.ReadOnly,
            },
            {
              id: "active-node",
              agent: "worker",
              task: "Apply the evidence.",
              dependsOn: ["completed-node"],
              handoff: "append_dependency_results",
              workspaceAccess: AgentChildWorkspaceAccessModes.ReadWrite,
            },
          ],
        },
      });
      repository.markRunning(created.id);
      repository.markNodeRunning(created.id, "completed-node", "child-completed");
      repository.markNodeTerminal(created.id, "completed-node", AgentWorkflowNodeStatuses.Completed);
      repository.markNodeRunning(created.id, "active-node", "child-active");
      database.close();

      database = new AgentOrchestrationDatabase(databasePath);
      repository = new AgentSqliteWorkflowRepository(database);
      expect(repository.recoverInterrupted("runtime restarted", "2026-08-05T00:00:02.000Z")).toBe(1);
      expect(repository.get(created.id)).toMatchObject({
        status: AgentWorkflowStatuses.Paused,
        nodes: [
          { nodeId: "completed-node", status: AgentWorkflowNodeStatuses.Completed, childRunId: "child-completed" },
          { nodeId: "active-node", status: AgentWorkflowNodeStatuses.Paused, childRunId: "child-active" },
        ],
      });

      const resumed = repository.resetForResume(created.id, "2026-08-05T00:00:03.000Z");
      expect(resumed).toMatchObject({
        status: AgentWorkflowStatuses.Queued,
        nodes: [
          { nodeId: "completed-node", status: AgentWorkflowNodeStatuses.Completed, childRunId: "child-completed" },
          { nodeId: "active-node", status: AgentWorkflowNodeStatuses.Pending, childRunId: "child-active" },
        ],
      });
    } finally {
      database?.close();
    }
  });

  test("orders child-run messages by their persisted insertion sequence", () => {
    const database = openDatabase();
    const repository = new AgentSqliteChildRunRepository(database);
    const child = repository.create(childRunInput("child-message-order"));
    const timestamp = "2026-08-05T00:00:00.000Z";

    repository.appendMessage(
      {
        id: "message-z-first",
        childRunId: child.id,
        direction: "child_to_parent",
        kind: "decision",
        content: "Choose a migration strategy.",
      },
      timestamp,
    );
    repository.appendMessage(
      {
        id: "message-a-second",
        childRunId: child.id,
        direction: "parent_to_child",
        kind: "response",
        content: "Use the safe strategy.",
      },
      timestamp,
    );

    expect(repository.get(child.id)?.messages.map((message) => message.id)).toEqual([
      "message-z-first",
      "message-a-second",
    ]);
    database.close();
  });

  test("migrates a version-6 database to the text-only child result contract", () => {
    const databasePath = createDatabasePath();
    const legacy = new Database(databasePath);
    legacy.exec(
      fs.readFileSync(
        path.join(process.cwd(), "Source", "AgentSystem", "Orchestration", "Database", "snapshots", "0006.schema.sql"),
        "utf8",
      ),
    );
    legacy
      .prepare(
        `INSERT INTO child_runs (
           id, parent_session_id, parent_request_id, child_session_id, child_request_id,
           agent_name, task, context_mode, approval_mode, status,
           launch_contract_digest, launch_contract_json, allowed_tool_names_json,
           final_answer, structured_result_json, created_at, updated_at,
           selected_skills_json, execution_contract_json
         ) VALUES (
           @id, @parent_session_id, @parent_request_id, @child_session_id, @child_request_id,
           @agent_name, @task, @context_mode, @approval_mode, @status,
           @launch_contract_digest, @launch_contract_json, @allowed_tool_names_json,
           @final_answer, @structured_result_json, @created_at, @updated_at,
           @selected_skills_json, @execution_contract_json
         )`,
      )
      .run({
        id: "child-text-migration",
        parent_session_id: "parent-child-text-migration",
        parent_request_id: "parent-request-child-text-migration",
        child_session_id: "session-child-text-migration",
        child_request_id: "request-child-text-migration",
        agent_name: "reviewer",
        task: "Review the implementation.",
        context_mode: AgentRunContextModes.Fork,
        approval_mode: AgentExecutionApprovalModes.Agent,
        status: AgentChildRunStatuses.Completed,
        launch_contract_digest: "digest-child-text-migration",
        launch_contract_json: JSON.stringify({ version: 2 }),
        allowed_tool_names_json: JSON.stringify(["ShellCommandTool"]),
        final_answer: "Decision: approved.",
        structured_result_json: JSON.stringify({ decision: "approved" }),
        created_at: "2026-08-05T00:00:00.000Z",
        updated_at: "2026-08-05T00:00:01.000Z",
        selected_skills_json: "[]",
        execution_contract_json: JSON.stringify({
          version: 3,
          workspaceAccess: AgentChildWorkspaceAccessModes.ReadWrite,
          promptLayer: { mode: "replace", content: "Review changes." },
          modelCandidateProviderIds: ["main"],
          inheritProjectContext: true,
          timeoutMs: 10_000,
          outputSchema: {
            type: "object",
            properties: { decision: { type: "string" } },
            required: ["decision"],
          },
        }),
      });
    legacy.close();

    const database = new AgentOrchestrationDatabase(databasePath);
    const repository = new AgentSqliteChildRunRepository(database);
    expect(repository.get("child-text-migration")).toMatchObject({
      finalAnswer: "Decision: approved.",
      executionContract: {
        version: 5,
        deadline: expect.objectContaining({ softTimeoutMs: 10_000 }),
      },
    });
    expect(repository.get("child-text-migration")).not.toHaveProperty("structuredResult");
    expect(
      (database.connection.pragma("table_info(child_runs)") as Array<{ name: string }>).map((column) => column.name),
    ).not.toContain("structured_result_json");
    database.close();
  });

  test("migrates version-7 supervisor checkpoints and preserves child-message foreign keys", () => {
    const databasePath = createDatabasePath();
    const legacy = new Database(databasePath);
    legacy.exec(
      fs.readFileSync(
        path.join(process.cwd(), "Source", "AgentSystem", "Orchestration", "Database", "snapshots", "0007.schema.sql"),
        "utf8",
      ),
    );
    legacy
      .prepare(
        `INSERT INTO child_runs (
           id, parent_session_id, parent_request_id, child_session_id, child_request_id,
           agent_name, task, context_mode, approval_mode, status,
           launch_contract_digest, launch_contract_json, allowed_tool_names_json,
           final_answer, created_at, updated_at, selected_skills_json, execution_contract_json
         ) VALUES (
           @id, @parent_session_id, @parent_request_id, @child_session_id, @child_request_id,
           @agent_name, @task, @context_mode, @approval_mode, @status,
           @launch_contract_digest, @launch_contract_json, @allowed_tool_names_json,
           @final_answer, @created_at, @updated_at, @selected_skills_json, @execution_contract_json
         )`,
      )
      .run({
        id: "child-supervisor-migration",
        parent_session_id: "parent-supervisor-migration",
        parent_request_id: "parent-request-supervisor-migration",
        child_session_id: "session-supervisor-migration",
        child_request_id: "request-supervisor-migration",
        agent_name: "reviewer",
        task: "Review the migration.",
        context_mode: AgentRunContextModes.Fresh,
        approval_mode: AgentExecutionApprovalModes.Agent,
        status: AgentChildRunStatuses.AwaitingSupervisor,
        launch_contract_digest: "digest-supervisor-migration",
        launch_contract_json: JSON.stringify({ version: 2 }),
        allowed_tool_names_json: JSON.stringify(["WorkspaceRead"]),
        final_answer: "I need the supervisor to choose a migration path.",
        created_at: "2026-08-05T00:00:00.000Z",
        updated_at: "2026-08-05T00:00:01.000Z",
        selected_skills_json: "[]",
        execution_contract_json: JSON.stringify({
          version: 4,
          workspaceAccess: AgentChildWorkspaceAccessModes.ReadOnly,
          promptLayer: { mode: "replace", content: "Review changes." },
          modelCandidateProviderIds: ["main"],
          inheritProjectContext: true,
          timeoutMs: 10_000,
        }),
      });
    legacy.close();

    const database = new AgentOrchestrationDatabase(databasePath);
    const repository = new AgentSqliteChildRunRepository(database);
    try {
      const migrated = repository.get("child-supervisor-migration");
      expect(migrated).toMatchObject({
        status: AgentChildRunStatuses.AwaitingSupervisor,
        executionContract: {
          version: 5,
          deadline: expect.objectContaining({ softTimeoutMs: 10_000 }),
        },
        checkpoint: {
          source: "supervisor_wait",
          content: "I need the supervisor to choose a migration path.",
          complete: true,
        },
      });
      expect(migrated).not.toHaveProperty("finalAnswer");

      repository.appendMessage({
        id: "message-after-v8-migration",
        childRunId: "child-supervisor-migration",
        direction: "parent_to_child",
        kind: "response",
        content: "Use the online migration path.",
      });
      expect(repository.get("child-supervisor-migration")?.messages).toEqual([
        expect.objectContaining({ id: "message-after-v8-migration" }),
      ]);
      const foreignKeys = database.connection.pragma("foreign_key_list(child_run_messages)") as Array<{
        table: string;
      }>;
      expect(foreignKeys.map((entry) => entry.table)).toContain("child_runs");
    } finally {
      database.close();
    }
  });

  test("removes the retired child-run turn budget during the version-14 migration", () => {
    const databasePath = createDatabasePath();
    const legacy = new Database(databasePath);
    legacy.exec(
      fs.readFileSync(
        path.join(process.cwd(), "Source", "AgentSystem", "Orchestration", "Database", "snapshots", "0013.schema.sql"),
        "utf8",
      ),
    );
    legacy
      .prepare(
        `INSERT INTO child_runs (
           id, owner_run_id, node_id, parent_session_id, parent_request_id,
           child_session_id, child_request_id, agent_name, task, context_mode,
           approval_mode, status, launch_contract_digest, launch_contract_json,
           allowed_tool_names_json, selected_skills_json, execution_contract_json,
           created_at, updated_at
         ) VALUES (
           @id, @owner_run_id, @node_id, @parent_session_id, @parent_request_id,
           @child_session_id, @child_request_id, @agent_name, @task, @context_mode,
           @approval_mode, @status, @launch_contract_digest, @launch_contract_json,
           @allowed_tool_names_json, @selected_skills_json, @execution_contract_json,
           @created_at, @updated_at
         )`,
      )
      .run({
        id: "child-retired-turn-budget",
        owner_run_id: "run-retired-turn-budget",
        node_id: "node-retired-turn-budget",
        parent_session_id: "parent-retired-turn-budget",
        parent_request_id: "request-retired-turn-budget",
        child_session_id: "session-retired-turn-budget",
        child_request_id: "child-request-retired-turn-budget",
        agent_name: "reviewer",
        task: "Review the migration.",
        context_mode: AgentRunContextModes.Fresh,
        approval_mode: AgentExecutionApprovalModes.Agent,
        status: AgentChildRunStatuses.Completed,
        launch_contract_digest: "digest-retired-turn-budget",
        launch_contract_json: JSON.stringify({ version: 2 }),
        allowed_tool_names_json: JSON.stringify(["WorkspaceRead"]),
        selected_skills_json: "[]",
        execution_contract_json: JSON.stringify({
          version: 5,
          workspaceAccess: AgentChildWorkspaceAccessModes.ReadOnly,
          promptLayer: { mode: "replace", content: "Review the migration." },
          modelCandidateProviderIds: ["main"],
          inheritProjectContext: false,
          deadline: testDeadlinePolicy(),
          turnBudget: { maxTurns: 12, graceTurns: 1 },
        }),
        created_at: "2026-08-11T00:00:00.000Z",
        updated_at: "2026-08-11T00:00:01.000Z",
      });
    legacy.close();

    const database = new AgentOrchestrationDatabase(databasePath);
    const repository = new AgentSqliteChildRunRepository(database);
    expect(repository.get("child-retired-turn-budget")).toMatchObject({
      id: "child-retired-turn-budget",
      executionContract: { version: 5 },
    });
    expect(
      JSON.parse(
        database.connection
          .prepare<[], { execution_contract_json: string }>(
            "SELECT execution_contract_json FROM child_runs WHERE id = 'child-retired-turn-budget'",
          )
          .get()!.execution_contract_json,
      ),
    ).not.toHaveProperty("turnBudget");
    database.close();
  });

  test("migrates version-8 child runs to stable owner-node identity and recoverable partial results", () => {
    const databasePath = createDatabasePath();
    const legacy = new Database(databasePath);
    legacy.exec(
      fs.readFileSync(
        path.join(process.cwd(), "Source", "AgentSystem", "Orchestration", "Database", "snapshots", "0008.schema.sql"),
        "utf8",
      ),
    );
    legacy
      .prepare(
        `INSERT INTO child_runs (
           id, parent_session_id, parent_request_id, child_session_id, child_request_id,
           agent_name, task, context_mode, approval_mode, status,
           launch_contract_digest, launch_contract_json, allowed_tool_names_json,
           checkpoint_json, created_at, started_at, updated_at,
           selected_skills_json, execution_contract_json
         ) VALUES (
           @id, @parent_session_id, @parent_request_id, @child_session_id, @child_request_id,
           @agent_name, @task, @context_mode, @approval_mode, @status,
           @launch_contract_digest, @launch_contract_json, @allowed_tool_names_json,
           @checkpoint_json, @created_at, @started_at, @updated_at,
           @selected_skills_json, @execution_contract_json
         )`,
      )
      .run({
        id: "child-v8-migration",
        parent_session_id: "parent-v8-migration",
        parent_request_id: "owner-v8-migration",
        child_session_id: "session-v8-migration",
        child_request_id: "request-v8-migration",
        agent_name: "reviewer",
        task: "Review the migration.",
        context_mode: AgentRunContextModes.Fresh,
        approval_mode: AgentExecutionApprovalModes.Agent,
        status: AgentChildRunStatuses.Running,
        launch_contract_digest: "digest-v8-migration",
        launch_contract_json: JSON.stringify({ version: 2 }),
        allowed_tool_names_json: JSON.stringify(["WorkspaceRead"]),
        checkpoint_json: JSON.stringify({
          version: 1,
          capturedAt: "2026-08-05T00:00:01.000Z",
          source: "model_stream",
          content: "Evidence captured before restart.",
          complete: false,
        }),
        created_at: "2026-08-05T00:00:00.000Z",
        started_at: "2026-08-05T00:00:00.500Z",
        updated_at: "2026-08-05T00:00:01.000Z",
        selected_skills_json: "[]",
        execution_contract_json: JSON.stringify({
          version: 5,
          workspaceAccess: AgentChildWorkspaceAccessModes.ReadOnly,
          promptLayer: { mode: "replace", content: "Review changes." },
          modelCandidateProviderIds: ["main"],
          inheritProjectContext: true,
          capabilityCeiling: {
            version: 1,
            allowedTools: ["WorkspaceRead"],
            allowedAgents: ["reviewer"],
            denyExtensions: true,
            sources: ["parent-policy"],
          },
          deadline: {
            softTimeoutMs: 10_000,
            wrapUpTimeoutMs: 1_000,
            snapshotIntervalMs: 100,
            activityExtension: {
              recentModelOutputWindowMs: 1_000,
              stepMs: 1_000,
              maximumMs: 2_000,
            },
          },
        }),
      });
    legacy.close();

    const database = new AgentOrchestrationDatabase(databasePath);
    const repository = new AgentSqliteChildRunRepository(database);
    try {
      expect(repository.get("child-v8-migration")).toMatchObject({
        ownerRunId: "owner-v8-migration",
        nodeId: "child-v8-migration",
        executionContract: {
          capabilityCeiling: {
            allowedTools: ["WorkspaceRead"],
            allowedAgents: ["reviewer"],
            denyExtensions: true,
          },
          deadline: {
            activityExtension: expect.objectContaining({ recentActivityWindowMs: 1_000 }),
          },
        },
      });
      expect(
        JSON.parse(
          database.connection
            .prepare<[], { execution_contract_json: string }>(
              "SELECT execution_contract_json FROM child_runs WHERE id = 'child-v8-migration'",
            )
            .get()!.execution_contract_json,
        ),
      ).not.toHaveProperty("deadline.activityExtension.recentModelOutputWindowMs");
      expect(repository.recoverInterrupted("runtime restarted", "2026-08-05T00:00:02.000Z")).toBe(1);
      expect(repository.get("child-v8-migration")).toMatchObject({
        status: AgentChildRunStatuses.Interrupted,
        finalAnswer: "Evidence captured before restart.",
        error: "runtime restarted",
      });
    } finally {
      database.close();
    }
  });

  test("round-trips scheduled tasks, full run history, and explicit tool ceilings", async () => {
    const database = openDatabase();
    const store = new AgentSqliteScheduledTaskStore(database);
    const task = scheduledTask();
    await store.create(task);
    store.setAllowedToolNames(task.id, ["ShellCommandTool", "ShellCommandTool"]);

    const updated = await store.update(task.id, {
      ...task,
      updatedAt: "2026-08-05T00:01:00.000Z",
      lastStatus: "success",
      runCount: 1,
      runHistory: [
        {
          id: "task-run-1",
          status: "success",
          sessionId: "scheduled-session-1",
          createdAt: "2026-08-05T00:00:30.000Z",
          message: "Run completed",
        },
      ],
    });

    expect(updated).toMatchObject({ id: task.id, runCount: 1, lastStatus: "success" });
    expect(updated?.runHistory).toEqual([
      expect.objectContaining({ id: "task-run-1", status: "success", sessionId: "scheduled-session-1" }),
    ]);
    expect(store.allowedToolNames(task.id)).toEqual(["ShellCommandTool"]);
    expect(await store.list({ tenantId: "tenant-a", userId: "user-a" })).toHaveLength(1);
    expect(await store.list({ tenantId: "tenant-b" })).toHaveLength(0);
    database.close();
  });

  test("allows only one live scheduler lease and supports expiry takeover", () => {
    const database = openDatabase();
    let now = 1_000;
    const first = new AgentSqliteSchedulerLock(database, {
      name: "scheduler",
      path: "orchestration.sqlite",
      holderId: "holder-a",
      holderPid: 11,
      leaseDurationMs: 100,
      now: () => now,
    });
    const second = new AgentSqliteSchedulerLock(database, {
      name: "scheduler",
      path: "orchestration.sqlite",
      holderId: "holder-b",
      holderPid: 22,
      leaseDurationMs: 100,
      now: () => now,
    });

    expect(first.acquire()).toBe(true);
    expect(second.acquire()).toBe(false);
    expect(second.holderPid()).toBe(11);
    now = 1_101;
    expect(second.acquire()).toBe(true);
    expect(second.holderPid()).toBe(22);
    expect(first.isAcquired()).toBe(false);
    database.close();
  });
});

function openDatabase(): AgentOrchestrationDatabase {
  return new AgentOrchestrationDatabase(createDatabasePath());
}

function createDatabasePath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "senera-orchestration-"));
  roots.push(root);
  return path.join(root, "orchestration.sqlite");
}

function childRunInput(id: string): AgentChildRunCreateInput {
  return {
    id,
    parentSessionId: `parent-${id}`,
    parentRequestId: `parent-request-${id}`,
    childSessionId: `session-${id}`,
    childRequestId: `request-${id}`,
    agentName: "reviewer",
    task: "Review the implementation.",
    contextMode: AgentRunContextModes.Fork,
    approvalMode: AgentExecutionApprovalModes.Agent,
    modelProviderId: "main",
    modelSelectionSource: AgentChildRunModelSelectionSources.Parent,
    selectedSkills: [],
    launchContractDigest: `digest-${id}`,
    launchContract: { version: 2 },
    allowedToolNames: ["ShellCommandTool"],
    executionContract: {
      version: 5,
      workspaceAccess: AgentChildWorkspaceAccessModes.ReadWrite,
      promptLayer: { mode: "replace", content: "Review changes." },
      modelCandidateProviderIds: ["main"],
      inheritProjectContext: true,
      deadline: testDeadlinePolicy(),
    },
  };
}

function scheduledTask(): ScheduledTask {
  return {
    id: "task-1",
    tenantId: "tenant-a",
    userId: "user-a",
    workspaceId: "workspace-a",
    sessionId: "owner-session",
    name: "Daily review",
    description: "Review the workspace each day.",
    prompt: "Review the workspace.",
    type: "cron",
    schedule: "0 9 * * *",
    intervalSeconds: 0,
    enabled: true,
    model: { provider: "main", model: "gpt-5", reasoning: true },
    toolPolicyProfile: AgentScheduledTaskToolPolicyProtocol.type,
    workspaceDir: "E:/workspace",
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
    runCount: 0,
    runHistory: [],
  };
}

function testDeadlinePolicy() {
  return {
    softTimeoutMs: 10_000,
    wrapUpTimeoutMs: 1_000,
    snapshotIntervalMs: 100,
    activityExtension: {
      recentActivityWindowMs: 1_000,
      stepMs: 1_000,
      maximumMs: 2_000,
    },
  } as const;
}
