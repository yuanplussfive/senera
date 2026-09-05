import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ScheduledTask } from "@amaster.ai/pi-task-scheduler";
import { AgentOrchestrationDatabase } from "../../../Source/AgentSystem/Orchestration/AgentOrchestrationDatabase.js";
import { AgentScheduleRuntime } from "../../../Source/AgentSystem/Orchestration/AgentScheduleRuntime.js";
import { AgentOrchestrationEventRelay } from "../../../Source/AgentSystem/Orchestration/AgentOrchestrationEventRelay.js";
import { AgentSqliteScheduledTaskStore } from "../../../Source/AgentSystem/Orchestration/AgentSqliteScheduledTaskStore.js";
import { AgentRunContextModes } from "../../../Source/AgentSystem/Orchestration/AgentRunDispatchPort.js";
import { AgentScheduledTaskToolPolicyProtocol } from "../../../Source/AgentSystem/Orchestration/AgentOrchestrationProtocols.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("scheduled task SQLite persistence", () => {
  test("claims missed scheduled work once, recovers expired execution, and retains delivery state", async () => {
    const database = openDatabase();
    try {
      const store = new AgentSqliteScheduledTaskStore(database);
      const task = {
        ...scheduledTask(),
        id: "task-missed-once",
        type: "once" as const,
        schedule: "2026-08-05T00:00:00.000Z",
        intervalSeconds: 1,
        nextRunAt: "2026-08-05T00:00:00.000Z",
      };
      await store.create(task);

      const first = store.claimDue({
        now: "2026-08-05T00:02:00.000Z",
        claimUntil: "2026-08-05T00:07:00.000Z",
        nextRunAt: () => undefined,
      });
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({
        task: { id: task.id, enabled: true },
        run: { executionStatus: "claimed", attempt: 1, scheduledFor: task.nextRunAt },
      });
      expect(await store.get(task.id)).toMatchObject({ enabled: false });
      expect(
        store.claimDue({
          now: "2026-08-05T00:03:00.000Z",
          claimUntil: "2026-08-05T00:08:00.000Z",
          nextRunAt: () => undefined,
        }),
      ).toEqual([]);

      const recovered = store.claimDue({
        now: "2026-08-05T00:07:01.000Z",
        claimUntil: "2026-08-05T00:12:01.000Z",
        nextRunAt: () => undefined,
      });
      expect(recovered).toEqual([
        expect.objectContaining({
          run: expect.objectContaining({ id: first[0]!.run.id, executionStatus: "claimed", attempt: 2 }),
        }),
      ]);

      const recoveredRun = recovered[0]!.run;
      const started = store.markRunning(
        recoveredRun.id,
        recoveredRun.claimId!,
        "2026-08-05T00:12:01.000Z",
        "2026-08-05T00:07:01.000Z",
      );
      expect(started).toMatchObject({ executionStatus: "running" });
      const completed = store.completeSuccess(
        recoveredRun.id,
        recoveredRun.claimId!,
        "Reminder: time to work.",
        "2026-08-05T00:07:10.000Z",
      );
      expect(completed).toMatchObject({ executionStatus: "succeeded", deliveryStatus: "pending" });

      const deliveries = store.claimPendingDeliveries("2026-08-05T00:07:11.000Z", "2026-08-05T00:12:11.000Z");
      expect(deliveries).toEqual([
        expect.objectContaining({
          task: expect.objectContaining({ sessionId: "owner-session" }),
          run: expect.objectContaining({ id: recoveredRun.id, result: "Reminder: time to work." }),
        }),
      ]);
      expect(store.markDelivered(deliveries[0]!.run.id, deliveries[0]!.claimId, "2026-08-05T00:07:12.000Z")).toBe(true);
      expect(store.claimPendingDeliveries("2026-08-05T00:07:13.000Z", "2026-08-05T00:12:13.000Z")).toEqual([]);
    } finally {
      database.close();
    }
  });

  test("round-trips scheduled task ownership and explicit tool ceilings", async () => {
    const database = openDatabase();
    try {
      const store = new AgentSqliteScheduledTaskStore(database);
      const task = scheduledTask();
      await store.create(task);
      store.setAllowedToolNames(task.id, ["ShellCommandTool", "ShellCommandTool"]);
      const updated = await store.update(task.id, {
        ...task,
        name: "Updated review",
        updatedAt: "2026-08-05T00:01:00.000Z",
      });

      expect(updated).toMatchObject({ id: task.id, name: "Updated review", runHistory: [] });
      expect(store.allowedToolNames(task.id)).toEqual(["ShellCommandTool"]);
      expect(await store.list({ tenantId: "tenant-a", userId: "user-a" })).toHaveLength(1);
      expect(await store.list({ tenantId: "tenant-b" })).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  test("reconciles overdue work at runtime startup and delivers the terminal result", async () => {
    const database = openDatabase();
    try {
      const store = new AgentSqliteScheduledTaskStore(database);
      const task = {
        ...scheduledTask(),
        id: "task-recovered-on-startup",
        type: "once" as const,
        schedule: "2026-08-05T00:00:00.000Z",
        intervalSeconds: 1,
        nextRunAt: "2026-08-05T00:00:00.000Z",
      };
      await store.create(task);
      const dispatch = vi.fn(async () => ({
        sessionId: "scheduled-session",
        requestId: "scheduled-request",
        finalAnswer: "Reminder delivered after recovery.",
        completion: "complete" as const,
      }));
      const deliver = vi.fn(async () => "delivered" as const);
      const dispose = vi.fn(async (_sessionId: string) => undefined);
      const runtime = new AgentScheduleRuntime({
        workspaceRoot: "E:/workspace",
        config: () => ({ ModelProviders: [] }),
        store,
        dispatcher: {
          dispatch,
          requestFinalAnswer: async () => false,
          requestCancellation: async () => false,
          cancel: async () => false,
        },
        delivery: { deliver },
        sourceContext: {
          sessionExists: async () => true,
          resolveForkBoundary: async () => "owner-request",
        },
        executionSessions: { dispose },
        events: new AgentOrchestrationEventRelay(),
        pollIntervalMs: 1_000,
        claimDurationMs: 5_000,
        now: () => new Date("2026-08-05T00:02:00.000Z"),
      });

      await runtime.start();
      await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
      await vi.waitFor(() => expect(deliver).toHaveBeenCalledOnce());
      await runtime.stop();

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          input: task.prompt,
          contextMode: AgentRunContextModes.Fork,
          parent: { sessionId: task.sessionId, requestId: "owner-request" },
          sessionOwnership: { type: "scheduled_run", taskId: task.id },
        }),
      );
      expect(deliver).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: task.id,
          sessionId: task.sessionId,
          content: "Reminder delivered after recovery.",
        }),
      );
      expect(dispose).toHaveBeenCalledOnce();
      expect(dispose).toHaveBeenCalledWith(expect.stringMatching(/^scheduled_session_/));
      expect(await store.get(task.id)).toMatchObject({
        enabled: false,
        runCount: 1,
        lastStatus: "success",
        runHistory: [expect.objectContaining({ status: "success" })],
      });
    } finally {
      database.close();
    }
  });

  test("removes tasks whose owner session no longer exists before startup claims work", async () => {
    const database = openDatabase();
    try {
      const store = new AgentSqliteScheduledTaskStore(database);
      const task = {
        ...scheduledTask(),
        id: "orphaned-task",
        type: "once" as const,
        schedule: "2026-08-05T00:00:00.000Z",
        intervalSeconds: 1,
        nextRunAt: "2026-08-05T00:00:00.000Z",
      };
      await store.create(task);
      const dispatch = vi.fn();
      const runtime = new AgentScheduleRuntime({
        workspaceRoot: "E:/workspace",
        config: () => ({ ModelProviders: [] }),
        store,
        dispatcher: {
          dispatch,
          requestFinalAnswer: async () => false,
          requestCancellation: async () => false,
          cancel: async () => false,
        },
        delivery: { deliver: async () => "missing" },
        sourceContext: {
          sessionExists: async () => false,
          resolveForkBoundary: async () => undefined,
        },
        executionSessions: { dispose: async () => undefined },
        events: new AgentOrchestrationEventRelay(),
        pollIntervalMs: 1_000,
        claimDurationMs: 5_000,
        now: () => new Date("2026-08-05T00:02:00.000Z"),
      });

      await runtime.start();
      await runtime.stop();

      expect(dispatch).not.toHaveBeenCalled();
      await expect(store.get(task.id)).resolves.toBeUndefined();
    } finally {
      database.close();
    }
  });

  test("cancels an active execution when its schedule is deleted", async () => {
    const database = openDatabase();
    try {
      const store = new AgentSqliteScheduledTaskStore(database);
      const task = {
        ...scheduledTask(),
        id: "task-delete-active",
        type: "once" as const,
        schedule: "2026-08-05T00:00:00.000Z",
        intervalSeconds: 1,
        nextRunAt: "2026-08-05T00:00:00.000Z",
      };
      await store.create(task);
      let rejectDispatch!: (error: unknown) => void;
      const dispatch = vi.fn(
        async (request: { signal?: AbortSignal }) =>
          new Promise<never>((_resolve, reject) => {
            rejectDispatch = reject;
            request.signal?.addEventListener("abort", () => reject(request.signal?.reason), { once: true });
          }),
      );
      const cancel = vi.fn(async () => true);
      const runtime = new AgentScheduleRuntime({
        workspaceRoot: "E:/workspace",
        config: () => ({ ModelProviders: [] }),
        store,
        dispatcher: {
          dispatch,
          requestFinalAnswer: async () => false,
          requestCancellation: async () => false,
          cancel,
        },
        delivery: { deliver: async () => "missing" },
        sourceContext: {
          sessionExists: async () => true,
          resolveForkBoundary: async () => "owner-request",
        },
        executionSessions: { dispose: async () => undefined },
        events: new AgentOrchestrationEventRelay(),
        pollIntervalMs: 1_000,
        claimDurationMs: 5_000,
        now: () => new Date("2026-08-05T00:00:00.000Z"),
      });

      await runtime.start();
      await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
      expect(await runtime.delete(task.id, task.sessionId)).toBe(true);
      expect(cancel).toHaveBeenCalledOnce();
      expect(rejectDispatch).toBeDefined();
      await expect(store.get(task.id)).resolves.toBeUndefined();
      await runtime.stop();
    } finally {
      database.close();
    }
  });
});

function openDatabase(): AgentOrchestrationDatabase {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "senera-scheduled-task-"));
  roots.push(root);
  return new AgentOrchestrationDatabase(path.join(root, "orchestration.sqlite"));
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
