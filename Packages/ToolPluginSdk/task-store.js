"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { RequestIdSchema, RequestSchema, ResultSchema, TaskSchema } = require("@modelcontextprotocol/sdk/types.js");
const { z } = require("zod");
const { TaskEventPageLimit } = require("./protocol.js");

const StoredTaskFormatVersion = 1;
const DefaultPageSize = 50;
const MaxTimerDelayMs = 2_147_483_647;
const NonTerminalTaskStatuses = new Set(["working", "input_required"]);
const StoredTaskRecordSchema = z
  .object({
    version: z.literal(StoredTaskFormatVersion),
    task: TaskSchema,
    requestId: RequestIdSchema,
    request: RequestSchema,
    sessionId: z.string().optional(),
    result: ResultSchema.optional(),
    expiresAt: z.number().int().nonnegative().nullable(),
  })
  .strict();
const TaskEventPayloadSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("output"),
      output: z
        .object({
          stream: z.enum(["stdout", "stderr"]),
          text: z.string(),
          byteLength: z.number().int().nonnegative(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("progress"),
      progress: z
        .object({
          completed: z.number().finite(),
          total: z.number().finite().optional(),
          message: z.string().optional(),
        })
        .strict(),
    })
    .strict(),
]);
const StoredTaskEventSchema = z.discriminatedUnion("kind", [
  z
    .object({
      taskId: z.string().min(1),
      cursor: z.number().int().positive(),
      timestamp: z.string().datetime(),
      kind: z.literal("output"),
      output: z
        .object({
          stream: z.enum(["stdout", "stderr"]),
          text: z.string(),
          byteLength: z.number().int().nonnegative(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      taskId: z.string().min(1),
      cursor: z.number().int().positive(),
      timestamp: z.string().datetime(),
      kind: z.literal("progress"),
      progress: z
        .object({
          completed: z.number().finite(),
          total: z.number().finite().optional(),
          message: z.string().optional(),
        })
        .strict(),
    })
    .strict(),
]);
const StoredTaskEventRecordSchema = z
  .object({
    version: z.literal(StoredTaskFormatVersion),
    event: StoredTaskEventSchema,
  })
  .strict();

class FileTaskStore {
  constructor(options) {
    if (!options || !path.isAbsolute(options.rootPath)) {
      throw new TypeError("FileTaskStore rootPath must be an absolute path.");
    }
    if (options.defaultTtl !== undefined && options.defaultTtl !== null) assertPositiveDuration(options.defaultTtl);
    if (options.pollInterval !== undefined) assertPositiveDuration(options.pollInterval);
    if (options.pageSize !== undefined) assertPositiveInteger(options.pageSize, "pageSize");

    this.rootPath = path.normalize(options.rootPath);
    this.defaultTtl = options.defaultTtl;
    this.pollInterval = options.pollInterval ?? 1000;
    this.pageSize = options.pageSize ?? DefaultPageSize;
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? (() => crypto.randomBytes(16).toString("hex"));
    this.tails = new Map();
    this.cleanupTimers = new Map();
    this.eventSequences = new Map();
    this.initialization = this.initialize();
  }

  async createTask(taskParams, requestId, request, sessionId) {
    await this.initialization;
    const taskId = this.idFactory();
    return this.withTask(taskId, async () => {
      const filePath = this.taskPath(taskId);
      if (await exists(filePath)) throw new Error(`Task with ID ${taskId} already exists.`);
      const ttl = taskParams.ttl === undefined ? (this.defaultTtl ?? null) : taskParams.ttl;
      if (ttl !== null) assertPositiveDuration(ttl);
      const timestamp = new Date(this.now()).toISOString();
      const task = {
        taskId,
        status: "working",
        ttl,
        createdAt: timestamp,
        lastUpdatedAt: timestamp,
        pollInterval: taskParams.pollInterval ?? this.pollInterval,
      };
      const record = {
        version: StoredTaskFormatVersion,
        task,
        requestId,
        request,
        ...(sessionId ? { sessionId } : {}),
        expiresAt: expirationFrom(timestamp, ttl),
      };
      await this.writeRecord(record);
      this.scheduleCleanup(record);
      return { ...task };
    });
  }

  async getTask(taskId, sessionId) {
    await this.initialization;
    return this.withTask(taskId, async () => {
      const record = await this.readLiveRecord(taskId, sessionId);
      return record ? { ...record.task } : null;
    });
  }

  async storeTaskResult(taskId, status, result, sessionId) {
    await this.initialization;
    return this.withTask(taskId, async () => {
      const record = await this.requireLiveRecord(taskId, sessionId);
      assertMutableTask(record.task);
      const updated = finalizeRecord(record, status, result, undefined, this.now());
      await this.writeRecord(updated);
      this.scheduleCleanup(updated);
    });
  }

  async getTaskResult(taskId, sessionId) {
    await this.initialization;
    return this.withTask(taskId, async () => {
      const record = await this.requireLiveRecord(taskId, sessionId);
      if (record.result === undefined) throw new Error(`Task ${taskId} has no result stored.`);
      return structuredClone(record.result);
    });
  }

  async updateTaskStatus(taskId, status, statusMessage, sessionId) {
    await this.initialization;
    return this.withTask(taskId, async () => {
      const record = await this.requireLiveRecord(taskId, sessionId);
      assertMutableTask(record.task);
      const timestamp = new Date(this.now()).toISOString();
      const terminal = isTerminalTaskStatus(status);
      const updated = {
        ...record,
        task: {
          ...record.task,
          status,
          lastUpdatedAt: timestamp,
          ...(statusMessage ? { statusMessage } : {}),
        },
        expiresAt: terminal ? expirationFrom(timestamp, record.task.ttl) : record.expiresAt,
      };
      await this.writeRecord(updated);
      this.scheduleCleanup(updated);
    });
  }

  async listTasks(cursor, sessionId) {
    await this.initialization;
    const records = await this.readAllLiveRecords(sessionId);
    const startIndex = resolveCursorIndex(records, cursor);
    const page = records.slice(startIndex, startIndex + this.pageSize);
    const nextCursor = startIndex + this.pageSize < records.length ? page.at(-1)?.task.taskId : undefined;
    return {
      tasks: page.map((record) => ({ ...record.task })),
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  async appendTaskEvent(taskId, event) {
    await this.initialization;
    return this.withTask(taskId, async () => {
      const record = await this.requireLiveRecord(taskId);
      assertMutableTask(record.task);
      const payload = TaskEventPayloadSchema.parse(event);
      const cursor = await this.nextTaskEventCursor(taskId);
      const stored = StoredTaskEventSchema.parse({
        taskId,
        cursor,
        timestamp: new Date(this.now()).toISOString(),
        ...payload,
      });
      const directory = this.taskEventDirectory(taskId);
      await fs.mkdir(directory, { recursive: true });
      await writeJsonAtomic(path.join(directory, `${cursor}.json`), {
        version: StoredTaskFormatVersion,
        event: stored,
      });
      this.eventSequences.set(taskId, cursor);
      return structuredClone(stored);
    });
  }

  async readTaskEvents(taskId, afterCursor = 0, limit = TaskEventPageLimit) {
    assertNonNegativeInteger(afterCursor, "afterCursor");
    assertPositiveInteger(limit, "limit");
    if (limit > TaskEventPageLimit) throw new RangeError(`limit cannot exceed ${TaskEventPageLimit}: ${limit}`);
    await this.initialization;
    return this.withTask(taskId, async () => {
      await this.requireLiveRecord(taskId);
      const cursors = (await this.readTaskEventCursors(taskId)).filter((cursor) => cursor > afterCursor);
      const pageCursors = cursors.slice(0, limit);
      const events = await Promise.all(pageCursors.map((cursor) => this.readTaskEvent(taskId, cursor)));
      return {
        events,
        nextCursor: events.at(-1)?.cursor ?? afterCursor,
        hasMore: cursors.length > pageCursors.length,
      };
    });
  }

  dispose() {
    for (const timer of this.cleanupTimers.values()) clearTimeout(timer);
    this.cleanupTimers.clear();
  }

  async initialize() {
    await fs.mkdir(this.rootPath, { recursive: true });
    await fs.mkdir(this.eventsRootPath(), { recursive: true });
    const records = await this.readAllRecords();
    await Promise.all(
      records.map((record) =>
        this.withTask(record.task.taskId, async () => {
          if (this.isExpired(record)) {
            await this.deleteTask(record.task.taskId);
            return;
          }
          if (NonTerminalTaskStatuses.has(record.task.status)) {
            const failed = finalizeRecord(
              record,
              "failed",
              orphanedTaskResult(record.task.taskId),
              "The MCP server process that owned this task stopped before completion.",
              this.now(),
            );
            await this.writeRecord(failed);
            this.scheduleCleanup(failed);
            return;
          }
          this.scheduleCleanup(record);
        }),
      ),
    );
  }

  async readAllLiveRecords(sessionId) {
    const records = await this.readAllRecords();
    const live = [];
    for (const record of records) {
      if (!matchesSession(record, sessionId)) continue;
      if (this.isExpired(record)) {
        await this.withTask(record.task.taskId, () => this.deleteTask(record.task.taskId));
        continue;
      }
      live.push(record);
    }
    return live.sort(compareStoredTasks);
  }

  async readAllRecords() {
    const entries = await fs.readdir(this.rootPath, { withFileTypes: true });
    const records = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => this.readRecordPath(path.join(this.rootPath, entry.name))),
    );
    return records;
  }

  async readLiveRecord(taskId, sessionId) {
    const record = await this.readRecordPath(this.taskPath(taskId), true);
    if (!record || !matchesSession(record, sessionId)) return null;
    if (!this.isExpired(record)) return record;
    await this.deleteTask(taskId);
    return null;
  }

  async requireLiveRecord(taskId, sessionId) {
    const record = await this.readLiveRecord(taskId, sessionId);
    if (!record) throw new Error(`Task with ID ${taskId} not found.`);
    return record;
  }

  async readRecordPath(filePath, missingAllowed = false) {
    try {
      const serialized = await fs.readFile(filePath, "utf8");
      return StoredTaskRecordSchema.parse(JSON.parse(serialized));
    } catch (error) {
      if (missingAllowed && isMissingFileError(error)) return null;
      throw new Error(`Failed to read MCP task state ${filePath}.`, { cause: error });
    }
  }

  async writeRecord(record) {
    const validated = StoredTaskRecordSchema.parse(record);
    await writeJsonAtomic(this.taskPath(validated.task.taskId), validated);
  }

  taskPath(taskId) {
    assertTaskId(taskId);
    return path.join(this.rootPath, `${taskId}.json`);
  }

  eventsRootPath() {
    return path.join(this.rootPath, "events");
  }

  taskEventDirectory(taskId) {
    assertTaskId(taskId);
    return path.join(this.eventsRootPath(), taskId);
  }

  async nextTaskEventCursor(taskId) {
    const cached = this.eventSequences.get(taskId);
    if (cached !== undefined) return cached + 1;
    const cursors = await this.readTaskEventCursors(taskId);
    const latest = cursors.at(-1) ?? 0;
    this.eventSequences.set(taskId, latest);
    return latest + 1;
  }

  async readTaskEventCursors(taskId) {
    try {
      const entries = await fs.readdir(this.taskEventDirectory(taskId), { withFileTypes: true });
      return entries
        .flatMap((entry) => {
          const match = entry.isFile() ? /^(\d+)\.json$/u.exec(entry.name) : null;
          const cursor = match ? Number(match[1]) : NaN;
          return Number.isSafeInteger(cursor) && cursor > 0 ? [cursor] : [];
        })
        .sort((left, right) => left - right);
    } catch (error) {
      if (isMissingFileError(error)) return [];
      throw error;
    }
  }

  async readTaskEvent(taskId, cursor) {
    const eventPath = path.join(this.taskEventDirectory(taskId), `${cursor}.json`);
    try {
      const serialized = await fs.readFile(eventPath, "utf8");
      return StoredTaskEventRecordSchema.parse(JSON.parse(serialized)).event;
    } catch (error) {
      throw new Error(`Failed to read MCP task event ${eventPath}.`, { cause: error });
    }
  }

  isExpired(record) {
    return record.expiresAt !== null && record.expiresAt <= this.now();
  }

  scheduleCleanup(record) {
    const taskId = record.task.taskId;
    const current = this.cleanupTimers.get(taskId);
    if (current) clearTimeout(current);
    this.cleanupTimers.delete(taskId);
    if (record.expiresAt === null) return;
    const delay = Math.min(MaxTimerDelayMs, Math.max(0, record.expiresAt - this.now()));
    const timer = setTimeout(() => {
      this.cleanupTimers.delete(taskId);
      void this.withTask(taskId, async () => {
        const latest = await this.readRecordPath(this.taskPath(taskId), true);
        if (!latest) return;
        if (this.isExpired(latest)) {
          await this.deleteTask(taskId);
          return;
        }
        this.scheduleCleanup(latest);
      }).catch(() => undefined);
    }, delay);
    timer.unref?.();
    this.cleanupTimers.set(taskId, timer);
  }

  async deleteTask(taskId) {
    const timer = this.cleanupTimers.get(taskId);
    if (timer) clearTimeout(timer);
    this.cleanupTimers.delete(taskId);
    this.eventSequences.delete(taskId);
    await fs.rm(this.taskPath(taskId), { force: true });
    await fs.rm(this.taskEventDirectory(taskId), { recursive: true, force: true });
  }

  async withTask(taskId, operation) {
    const previous = this.tails.get(taskId) ?? Promise.resolve();
    const execution = previous.catch(() => undefined).then(operation);
    const tail = execution.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(taskId, tail);
    try {
      return await execution;
    } finally {
      if (this.tails.get(taskId) === tail) this.tails.delete(taskId);
    }
  }
}

function finalizeRecord(record, status, result, statusMessage, now) {
  const timestamp = new Date(now).toISOString();
  return {
    ...record,
    task: {
      ...record.task,
      status,
      lastUpdatedAt: timestamp,
      ...(statusMessage ? { statusMessage } : {}),
    },
    result,
    expiresAt: expirationFrom(timestamp, record.task.ttl),
  };
}

function orphanedTaskResult(taskId) {
  const message = `MCP task ${taskId} lost its server process before completion.`;
  return {
    content: [{ type: "text", text: message }],
    structuredContent: { error: { code: "TaskOwnerLost", message, taskId } },
    isError: true,
  };
}

function expirationFrom(timestamp, ttl) {
  return ttl === null ? null : Date.parse(timestamp) + ttl;
}

function assertMutableTask(task) {
  if (isTerminalTaskStatus(task.status)) {
    throw new Error(`Cannot update task ${task.taskId} in terminal status '${task.status}'.`);
  }
}

function isTerminalTaskStatus(status) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function matchesSession(record, sessionId) {
  return sessionId === undefined || record.sessionId === undefined || record.sessionId === sessionId;
}

function resolveCursorIndex(records, cursor) {
  if (!cursor) return 0;
  const index = records.findIndex((record) => record.task.taskId === cursor);
  if (index < 0) throw new Error(`Invalid task cursor: ${cursor}`);
  return index + 1;
}

function compareStoredTasks(left, right) {
  return left.task.createdAt.localeCompare(right.task.createdAt) || left.task.taskId.localeCompare(right.task.taskId);
}

function assertPositiveDuration(value) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`Task duration must be positive: ${value}`);
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer: ${value}`);
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${label} must be a non-negative integer: ${value}`);
}

function assertTaskId(taskId) {
  if (!/^[A-Za-z0-9_-]+$/u.test(taskId)) throw new TypeError(`Invalid MCP task ID: ${taskId}`);
}

async function writeJsonAtomic(target, value) {
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "wx" });
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

function isMissingFileError(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

module.exports = { FileTaskStore };
