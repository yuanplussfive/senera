import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ScheduledTask } from "@amaster.ai/pi-task-scheduler";
import { AgentEventKinds, type AgentDomainEvent } from "../../../Source/AgentSystem/Events/AgentEvent.js";
import { AgentOrchestrationEventRelay } from "../../../Source/AgentSystem/Orchestration/AgentOrchestrationEventRelay.js";
import { AgentScheduledTaskToolPolicyProtocol } from "../../../Source/AgentSystem/Orchestration/AgentOrchestrationProtocols.js";
import { AgentScheduleRuntime } from "../../../Source/AgentSystem/Orchestration/AgentScheduleRuntime.js";
import {
  AgentScheduledTaskExecutionModes,
  type AgentScheduledTaskRecord,
} from "../../../Source/AgentSystem/Orchestration/AgentScheduledTaskRunTypes.js";
import { AgentSqliteScheduledTaskStore } from "../../../Source/AgentSystem/Orchestration/AgentSqliteScheduledTaskStore.js";
import { AgentOrchestrationDatabase } from "../../../Source/AgentSystem/Orchestration/AgentOrchestrationDatabase.js";
import {
  AgentRunContextModes,
  type AgentRunDispatchRequest,
} from "../../../Source/AgentSystem/Orchestration/AgentRunDispatchPort.js";
import { AgentExecutionApprovalModes } from "../../../Source/AgentSystem/Safety/AgentExecutionApprovalMode.js";

const roots: string[] = [];
const ImmediateAt = "2026-08-05T00:00:00.000Z";
const InitialDeliveryAt = "2026-08-05T01:00:00.000Z";
const RescheduledDeliveryAt = "2026-08-05T02:00:00.000Z";

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("scheduled task timing", () => {
  test("executes deferred work immediately, reschedules its delivery, and never executes it again at delivery time", async () => {
    const database = openDatabase();
    try {
      const store = new AgentSqliteScheduledTaskStore(database);
      const task = deferredTask("deferred-success");
      await store.create(task);

      expect(store.enqueueImmediate(task.id, ImmediateAt, InitialDeliveryAt)).toBe(true);
      expect(store.hasOutstandingRun(task.id)).toBe(true);

      const [claim] = store.claimDue({
        now: ImmediateAt,
        claimUntil: "2026-08-05T00:05:00.000Z",
        nextRunAt: () => undefined,
      });
      expect(claim).toMatchObject({
        task: { id: task.id, executionMode: AgentScheduledTaskExecutionModes.ExecuteNowDeliverAt },
        run: { scheduledFor: ImmediateAt, deliveryAt: InitialDeliveryAt, executionStatus: "claimed" },
      });

      const running = store.markRunning(
        claim!.run.id,
        claim!.run.claimId!,
        "2026-08-05T00:05:00.000Z",
        "2026-08-05T00:00:01.000Z",
      );
      expect(running).toMatchObject({ executionStatus: "running" });
      const completed = store.completeSuccess(
        claim!.run.id,
        claim!.run.claimId!,
        "Prepared report.",
        "2026-08-05T00:00:02.000Z",
      );
      expect(completed).toMatchObject({ executionStatus: "succeeded", deliveryStatus: "pending" });

      const rescheduled = await store.update(task.id, {
        ...task,
        schedule: RescheduledDeliveryAt,
        nextRunAt: RescheduledDeliveryAt,
        updatedAt: "2026-08-05T00:00:03.000Z",
      });
      expect(rescheduled).toMatchObject({ nextRunAt: RescheduledDeliveryAt });
      expect(store.claimPendingDeliveries(InitialDeliveryAt, "2026-08-05T01:05:00.000Z")).toEqual([]);
      expect(
        store.claimDue({
          now: RescheduledDeliveryAt,
          claimUntil: "2026-08-05T02:05:00.000Z",
          nextRunAt: () => undefined,
        }),
      ).toEqual([]);

      const deliveries = store.claimPendingDeliveries(RescheduledDeliveryAt, "2026-08-05T02:05:00.000Z");
      expect(deliveries).toEqual([
        expect.objectContaining({
          run: expect.objectContaining({ result: "Prepared report.", deliveryAt: RescheduledDeliveryAt }),
        }),
      ]);
      expect(store.markDelivered(deliveries[0]!.run.id, deliveries[0]!.claimId, "2026-08-05T02:00:01.000Z")).toBe(true);
      expect(await store.get(task.id)).toMatchObject({ enabled: false });
      expect(await store.get(task.id)).not.toHaveProperty("nextRunAt");
      expect(store.hasOutstandingRun(task.id)).toBe(false);
    } finally {
      database.close();
    }
  });

  test("retains deferred failures until delivery time and cancels delivery when the task is stopped", async () => {
    const database = openDatabase();
    try {
      const store = new AgentSqliteScheduledTaskStore(database);
      const task = deferredTask("deferred-failure");
      await store.create(task);
      store.enqueueImmediate(task.id, ImmediateAt, InitialDeliveryAt);

      const [claim] = store.claimDue({
        now: ImmediateAt,
        claimUntil: "2026-08-05T00:05:00.000Z",
        nextRunAt: () => undefined,
      });
      store.markRunning(claim!.run.id, claim!.run.claimId!, "2026-08-05T00:05:00.000Z", "2026-08-05T00:00:01.000Z");
      const completed = store.completeFailure(
        claim!.run.id,
        claim!.run.claimId!,
        "The report source is unavailable.",
        "2026-08-05T00:00:02.000Z",
      );
      expect(completed).toMatchObject({ executionStatus: "failed", deliveryStatus: "pending" });
      expect(store.claimPendingDeliveries("2026-08-05T00:30:00.000Z", "2026-08-05T00:35:00.000Z")).toEqual([]);

      const stopped = await store.update(task.id, {
        ...task,
        enabled: false,
        nextRunAt: undefined,
        updatedAt: "2026-08-05T00:30:01.000Z",
      });
      expect(stopped).toMatchObject({ enabled: false });
      expect(stopped).not.toHaveProperty("nextRunAt");
      expect(store.claimPendingDeliveries(InitialDeliveryAt, "2026-08-05T01:05:00.000Z")).toEqual([]);
      expect(await store.get(task.id)).toMatchObject({
        runHistory: [expect.objectContaining({ status: "error", message: "The report source is unavailable." })],
      });
    } finally {
      database.close();
    }
  });

  test("keeps immediate deferred execution private until its scheduled delivery", async () => {
    const database = openDatabase();
    try {
      const store = new AgentSqliteScheduledTaskStore(database);
      const task = deferredTask("deferred-private");
      await store.create(task);
      store.enqueueImmediate(task.id, ImmediateAt, InitialDeliveryAt);

      const dispatch = vi.fn(async (_request: AgentRunDispatchRequest) => ({
        sessionId: "scheduled-session",
        requestId: "scheduled-request",
        finalAnswer: "Prepared privately.",
        completion: "complete" as const,
      }));
      const deliver = vi.fn(async () => "delivered" as const);
      const dispose = vi.fn(async () => undefined);
      const events: AgentDomainEvent[] = [];
      const relay = new AgentOrchestrationEventRelay();
      relay.setSink((event) => {
        events.push(event);
      });
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
        events: relay,
        pollIntervalMs: 1_000,
        claimDurationMs: 5_000,
        now: () => new Date(ImmediateAt),
      });

      await runtime.start();
      await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
      await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
      await runtime.stop();

      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          contextMode: AgentRunContextModes.Fork,
          approvalMode: AgentExecutionApprovalModes.Agent,
          parent: { sessionId: task.sessionId, requestId: "owner-request" },
          sessionOwnership: { type: "scheduled_run", taskId: task.id },
        }),
      );
      expect(dispatch.mock.calls[0]![0]).not.toHaveProperty("onEvent");
      expect(deliver).not.toHaveBeenCalled();
      const ownerEventKinds = new Set<AgentDomainEvent["kind"]>([
        AgentEventKinds.RunStarted,
        AgentEventKinds.RunCompleted,
        AgentEventKinds.RunFailed,
        AgentEventKinds.ScheduledTaskRunStarted,
        AgentEventKinds.ScheduledTaskRunCompleted,
        AgentEventKinds.ScheduledTaskRunFailed,
      ]);
      expect(events.filter((event) => ownerEventKinds.has(event.kind))).toEqual([]);
    } finally {
      database.close();
    }
  });
});

function deferredTask(id: string): AgentScheduledTaskRecord {
  return {
    ...scheduledTask(),
    id,
    executionMode: AgentScheduledTaskExecutionModes.ExecuteNowDeliverAt,
    type: "once",
    schedule: InitialDeliveryAt,
    intervalSeconds: 0,
    nextRunAt: InitialDeliveryAt,
  };
}

function scheduledTask(): ScheduledTask {
  return {
    id: "task-1",
    tenantId: "tenant-a",
    userId: "user-a",
    workspaceId: "workspace-a",
    sessionId: "owner-session",
    name: "Deferred review",
    description: "Review the workspace before reporting later.",
    prompt: "Review the workspace.",
    type: "once",
    schedule: InitialDeliveryAt,
    intervalSeconds: 0,
    enabled: true,
    model: { provider: "main", model: "gpt-5", reasoning: true },
    toolPolicyProfile: AgentScheduledTaskToolPolicyProtocol.type,
    workspaceDir: "E:/workspace",
    createdAt: ImmediateAt,
    updatedAt: ImmediateAt,
    nextRunAt: InitialDeliveryAt,
    runCount: 0,
    runHistory: [],
  };
}

function openDatabase(): AgentOrchestrationDatabase {
  return new AgentOrchestrationDatabase(createDatabasePath());
}

function createDatabasePath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "senera-scheduled-task-timing-"));
  roots.push(root);
  return path.join(root, "orchestration.sqlite");
}
