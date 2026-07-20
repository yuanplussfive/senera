import type { CreateTaskOptions, TaskStore } from "@modelcontextprotocol/sdk/experimental/tasks";
import type { Request, RequestId, Result, Task } from "@modelcontextprotocol/sdk/types.js";
import type { TaskEventPayload, TaskEventStore, TaskEventsPage, StoredTaskEvent } from "./protocol";

export interface FileTaskStoreOptions {
  rootPath: string;
  defaultTtl?: number | null;
  pollInterval?: number;
  pageSize?: number;
  now?: () => number;
  idFactory?: () => string;
}

export class FileTaskStore implements TaskStore, TaskEventStore {
  constructor(options: FileTaskStoreOptions);
  createTask(taskParams: CreateTaskOptions, requestId: RequestId, request: Request, sessionId?: string): Promise<Task>;
  getTask(taskId: string, sessionId?: string): Promise<Task | null>;
  storeTaskResult(taskId: string, status: "completed" | "failed", result: Result, sessionId?: string): Promise<void>;
  getTaskResult(taskId: string, sessionId?: string): Promise<Result>;
  updateTaskStatus(taskId: string, status: Task["status"], statusMessage?: string, sessionId?: string): Promise<void>;
  listTasks(cursor?: string, sessionId?: string): Promise<{ tasks: Task[]; nextCursor?: string }>;
  appendTaskEvent(taskId: string, event: TaskEventPayload): Promise<StoredTaskEvent>;
  readTaskEvents(taskId: string, afterCursor?: number, limit?: number): Promise<TaskEventsPage>;
  dispose(): void;
}
