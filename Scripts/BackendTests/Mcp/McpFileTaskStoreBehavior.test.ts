import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Request, Result } from "@modelcontextprotocol/sdk/types.js";
import { FileTaskStore } from "@senera/tool-plugin-sdk/task-store";

const temporaryRoots: string[] = [];
const request: Request = { method: "tools/call", params: { name: "durable", arguments: { value: 1 } } };
const completedResult: Result = {
  content: [{ type: "text", text: "completed" }],
  structuredContent: { value: "completed" },
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("MCP file task store", () => {
  it("persists terminal task state and results across store instances", async () => {
    const rootPath = createTaskRoot();
    const first = new FileTaskStore({ rootPath, idFactory: () => "task-persisted" });
    const task = await first.createTask({ ttl: null }, "request-1", request, "session-1");
    await first.storeTaskResult(task.taskId, "completed", completedResult, "session-1");
    first.dispose();

    const reopened = new FileTaskStore({ rootPath });
    await expect(reopened.getTask(task.taskId, "session-1")).resolves.toMatchObject({
      taskId: task.taskId,
      status: "completed",
    });
    await expect(reopened.getTaskResult(task.taskId, "session-1")).resolves.toEqual(completedResult);
    reopened.dispose();
  });

  it("fails orphaned non-terminal tasks with a structured owner-loss result on restart", async () => {
    const rootPath = createTaskRoot();
    const first = new FileTaskStore({ rootPath, idFactory: () => "task-orphaned" });
    const task = await first.createTask({ ttl: null }, "request-2", request);
    first.dispose();

    const reopened = new FileTaskStore({ rootPath });
    await expect(reopened.getTask(task.taskId)).resolves.toMatchObject({
      taskId: task.taskId,
      status: "failed",
      statusMessage: expect.stringContaining("stopped before completion"),
    });
    await expect(reopened.getTaskResult(task.taskId)).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        error: { code: "TaskOwnerLost", taskId: task.taskId },
      },
    });
    reopened.dispose();
  });

  it("enforces terminal-state immutability and session isolation", async () => {
    const rootPath = createTaskRoot();
    const store = new FileTaskStore({ rootPath, idFactory: () => "task-terminal" });
    const task = await store.createTask({ ttl: null }, "request-3", request, "session-a");

    await expect(store.getTask(task.taskId, "session-b")).resolves.toBeNull();
    await store.updateTaskStatus(task.taskId, "cancelled", "cancelled by user", "session-a");
    await expect(store.storeTaskResult(task.taskId, "completed", completedResult, "session-a")).rejects.toThrow(
      "terminal status 'cancelled'",
    );
    store.dispose();
  });

  it("persists ordered task events and replays them from an exclusive cursor", async () => {
    const rootPath = createTaskRoot();
    const first = new FileTaskStore({ rootPath, idFactory: () => "task-events" });
    const task = await first.createTask({ ttl: null }, "request-events", request);
    await Promise.all([
      first.appendTaskEvent(task.taskId, {
        kind: "output",
        output: { stream: "stdout", text: "first", byteLength: 5 },
      }),
      first.appendTaskEvent(task.taskId, {
        kind: "progress",
        progress: { completed: 1, total: 2, message: "halfway" },
      }),
    ]);
    await first.storeTaskResult(task.taskId, "completed", completedResult);
    await expect(
      first.appendTaskEvent(task.taskId, {
        kind: "output",
        output: { stream: "stderr", text: "late", byteLength: 4 },
      }),
    ).rejects.toThrow("terminal status 'completed'");
    first.dispose();

    const reopened = new FileTaskStore({ rootPath });
    await expect(reopened.readTaskEvents(task.taskId, 0, 1)).resolves.toMatchObject({
      events: [expect.objectContaining({ taskId: task.taskId, cursor: 1, kind: "output" })],
      nextCursor: 1,
      hasMore: true,
    });
    await expect(reopened.readTaskEvents(task.taskId, 1)).resolves.toMatchObject({
      events: [expect.objectContaining({ taskId: task.taskId, cursor: 2, kind: "progress" })],
      nextCursor: 2,
      hasMore: false,
    });
    reopened.dispose();
  });

  it("removes tasks after their TTL expires", async () => {
    const rootPath = createTaskRoot();
    const store = new FileTaskStore({ rootPath, idFactory: () => "task-expiring" });
    const task = await store.createTask({ ttl: 20 }, "request-4", request);

    await expect.poll(() => store.getTask(task.taskId), { timeout: 2_000 }).toBeNull();
    expect(fs.existsSync(path.join(rootPath, `${task.taskId}.json`))).toBe(false);
    expect(fs.existsSync(path.join(rootPath, "events", task.taskId))).toBe(false);
    store.dispose();
  });

  it("requires an explicit absolute storage root", () => {
    expect(() => new FileTaskStore({ rootPath: "relative/tasks" })).toThrow("must be an absolute path");
  });
});

function createTaskRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "senera-mcp-task-store-"));
  temporaryRoots.push(root);
  return path.join(root, "tasks");
}
