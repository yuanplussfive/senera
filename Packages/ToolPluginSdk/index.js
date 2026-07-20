"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { InMemoryTaskStore } = require("@modelcontextprotocol/sdk/experimental/tasks");
const { parse: parseToml } = require("smol-toml");
const { z, ZodError } = require("zod");
const {
  TaskEventCapabilityName,
  TaskEventNotificationMethod,
  TaskEventPageLimit,
  TaskEventProtocolVersion,
  TaskEventsReadMethod,
  ToolOutputNotificationMethod,
  ToolPluginEnvironmentVariables,
  normalizeToolOutput,
} = require("./protocol.js");

const TaskEventsReadRequestSchema = z.object({
  method: z.literal(TaskEventsReadMethod),
  params: z
    .object({
      taskId: z.string().min(1),
      afterCursor: z.number().int().nonnegative().optional(),
      limit: z.number().int().positive().max(TaskEventPageLimit).optional(),
    })
    .strict(),
});

async function runMcpTool(definition) {
  return runMcpToolSuite([definition]);
}

async function runMcpToolSuite(definitions, options = {}) {
  const remoteJobTools = resolveRemoteJobTools(definitions, options);
  const taskStore = remoteJobTools.size > 0 ? new CancellableTaskStore(options.taskStore) : undefined;
  const taskEventStore = resolveTaskEventStore(remoteJobTools, options.taskEventStore);
  const server = new McpServer(
    {
      name: options.serverName ?? "senera-tool-plugin-mcp",
      version: options.serverVersion ?? "0.1.0",
    },
    {
      capabilities: {
        tools: {},
        ...(taskStore
          ? {
              tasks: {
                list: {},
                cancel: {},
                requests: { tools: { call: {} } },
              },
            }
          : {}),
        ...(taskEventStore
          ? {
              experimental: {
                [TaskEventCapabilityName]: { version: TaskEventProtocolVersion },
              },
            }
          : {}),
      },
      enforceStrictCapabilities: true,
      taskStore,
      taskMessageQueue: options.taskMessageQueue,
    },
  );
  if (taskEventStore) registerTaskEventReplay(server, taskEventStore);
  for (const definition of definitions) {
    if (remoteJobTools.has(definition.toolName)) {
      registerRemoteJobTool(server, definition, taskStore, taskEventStore);
    } else {
      registerImmediateTool(server, definition);
    }
  }
  await server.connect(new StdioServerTransport());
}

function registerImmediateTool(server, definition) {
  server.registerTool(definition.toolName, toolRegistration(definition), (args, extra) =>
    executeDefinition(definition, args, extra, extra.signal),
  );
}

function registerRemoteJobTool(server, definition, taskStore, taskEventStore) {
  server.experimental.tasks.registerToolTask(
    definition.toolName,
    {
      ...toolRegistration(definition),
      execution: { taskSupport: "required" },
    },
    {
      async createTask(args, extra) {
        const task = await extra.taskStore.createTask({ ttl: extra.taskRequestedTtl });
        const controller = taskStore.bind(task.taskId);
        void executeRemoteJob(definition, args, extra, task.taskId, taskStore, taskEventStore, controller).catch(
          (error) => reportRemoteJobInfrastructureFailure(definition.toolName, task.taskId, error),
        );
        return { task };
      },
      getTask: (_args, extra) => extra.taskStore.getTask(extra.taskId),
      getTaskResult: (_args, extra) => extra.taskStore.getTaskResult(extra.taskId),
    },
  );
}

function registerTaskEventReplay(server, taskEventStore) {
  server.server.setRequestHandler(TaskEventsReadRequestSchema, (request) =>
    taskEventStore.readTaskEvents(request.params.taskId, request.params.afterCursor, request.params.limit),
  );
}

function toolRegistration(definition) {
  return {
    description: definition.description ?? definition.toolName,
    inputSchema: definition.argumentSchema,
    outputSchema: definition.resultSchema,
  };
}

async function executeRemoteJob(definition, args, extra, taskId, taskStore, taskEventStore, controller) {
  const result = await executeDefinition(definition, args, extra, controller.signal, {
    taskId,
    store: taskEventStore,
  });
  const task = await taskStore.getTask(taskId);
  if (!task || task.status === "cancelled") return;
  try {
    await taskStore.storeTaskResult(taskId, result.isError ? "failed" : "completed", result);
  } catch (error) {
    const latest = await taskStore.getTask(taskId).catch(() => undefined);
    if (latest?.status !== "cancelled") throw error;
  }
}

function reportRemoteJobInfrastructureFailure(toolName, taskId, error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`[senera-tool-plugin-sdk] RemoteJob ${toolName} (${taskId}) failed: ${message}\n`);
}

async function executeDefinition(definition, input, extra, signal, taskEvents) {
  try {
    const args = definition.argumentSchema.parse(input ?? {});
    const rawResult = await definition.execute(args, normalizeMcpToolContext(extra, signal, taskEvents));
    const result = definition.resultSchema.parse(rawResult);
    return {
      content: [{ type: "text", text: projectResultText(definition, result) }],
      structuredContent: result,
    };
  } catch (error) {
    return mcpErrorResult(error);
  }
}

function projectResultText(definition, result) {
  const projected = definition.resultText?.(result);
  if (projected !== undefined && (typeof projected !== "string" || projected.trim().length === 0)) {
    throw new TypeError(`resultText for ${definition.toolName} must return a non-empty string.`);
  }
  return projected ?? `${definition.toolName} returned structured output.`;
}

function normalizeMcpToolContext(extra, signal, taskEvents) {
  const requestMetadata = readRecord(extra._meta);
  const metadata = readRecord(requestMetadata.senera);
  const progressToken = requestMetadata.progressToken;
  const outputToken = readOptionalString(metadata.outputToken);
  return {
    workspaceRoot: process.env.SENERA_TOOL_CONTEXT_WORKSPACE_ROOT,
    pluginRoot: process.env.SENERA_TOOL_CONTEXT_PLUGIN_ROOT,
    sessionId: readOptionalString(metadata.sessionId),
    requestId: readOptionalString(metadata.requestId),
    step: typeof metadata.step === "number" ? metadata.step : undefined,
    toolCallId: readOptionalString(metadata.toolCallId),
    batchId: readOptionalString(metadata.batchId),
    taskId: taskEvents?.taskId,
    signal,
    reportProgress: async (progress) => {
      const normalized = normalizeToolProgress(progress);
      if (taskEvents?.store) {
        const event = await taskEvents.store.appendTaskEvent(taskEvents.taskId, {
          kind: "progress",
          progress: normalized,
        });
        await sendTaskEventNotification(extra, event, { progressToken });
        return true;
      }
      if (progressToken === undefined) return false;
      await extra.sendNotification({
        method: "notifications/progress",
        params: {
          progressToken,
          progress: normalized.completed,
          total: normalized.total,
          message: normalized.message,
        },
      });
      return true;
    },
    reportOutput: async (output) => {
      const normalized = normalizeToolOutput(output);
      if (normalized.text.length === 0) return false;
      if (taskEvents?.store) {
        const event = await taskEvents.store.appendTaskEvent(taskEvents.taskId, {
          kind: "output",
          output: normalized,
        });
        await sendTaskEventNotification(extra, event, { outputToken });
        return true;
      }
      if (!outputToken) return false;
      await extra.sendNotification({
        method: ToolOutputNotificationMethod,
        params: {
          outputToken,
          ...normalized,
        },
      });
      return true;
    },
  };
}

async function sendTaskEventNotification(extra, event, tokens) {
  try {
    await extra.sendNotification({
      method: TaskEventNotificationMethod,
      params: {
        event,
        ...(tokens.outputToken ? { outputToken: tokens.outputToken } : {}),
        ...(tokens.progressToken !== undefined ? { progressToken: String(tokens.progressToken) } : {}),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `[senera-tool-plugin-sdk] Persisted MCP task event ${event.taskId}:${event.cursor}; live delivery failed: ${message}\n`,
    );
  }
}

function resolveRemoteJobTools(definitions, options) {
  const configured = options.remoteJobTools ?? parseRemoteJobToolsEnvironment();
  const knownTools = new Set(definitions.map((definition) => definition.toolName));
  const remoteJobTools = new Set(configured);
  for (const toolName of remoteJobTools) {
    if (!knownTools.has(toolName)) {
      throw new Error(`RemoteJob tool is not registered in this MCP server: ${toolName}`);
    }
  }
  return remoteJobTools;
}

function resolveTaskEventStore(remoteJobTools, taskEventStore) {
  if (!taskEventStore) return undefined;
  if (remoteJobTools.size === 0) throw new Error("taskEventStore requires at least one RemoteJob tool.");
  if (typeof taskEventStore.appendTaskEvent !== "function" || typeof taskEventStore.readTaskEvents !== "function") {
    throw new TypeError("taskEventStore must implement appendTaskEvent() and readTaskEvents().");
  }
  return taskEventStore;
}

function parseRemoteJobToolsEnvironment() {
  const serialized = process.env[ToolPluginEnvironmentVariables.RemoteJobTools];
  if (!serialized) return [];
  let value;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new Error(`${ToolPluginEnvironmentVariables.RemoteJobTools} must contain a JSON string array.`, {
      cause: error,
    });
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new TypeError(`${ToolPluginEnvironmentVariables.RemoteJobTools} must contain a JSON string array.`);
  }
  return value;
}

class CancellableTaskStore {
  constructor(delegate = new InMemoryTaskStore()) {
    this.delegate = delegate;
    this.controllers = new Map();
  }

  bind(taskId) {
    const controller = new AbortController();
    this.controllers.set(taskId, controller);
    return controller;
  }

  createTask(...args) {
    return this.delegate.createTask(...args);
  }

  getTask(...args) {
    return this.delegate.getTask(...args);
  }

  async storeTaskResult(taskId, ...args) {
    try {
      return await this.delegate.storeTaskResult(taskId, ...args);
    } finally {
      this.controllers.delete(taskId);
    }
  }

  getTaskResult(...args) {
    return this.delegate.getTaskResult(...args);
  }

  async updateTaskStatus(taskId, status, ...args) {
    await this.delegate.updateTaskStatus(taskId, status, ...args);
    if (status === "cancelled") this.controllers.get(taskId)?.abort(new Error(`MCP task ${taskId} was cancelled.`));
    if (status === "cancelled" || status === "completed" || status === "failed") this.controllers.delete(taskId);
  }

  listTasks(...args) {
    return this.delegate.listTasks(...args);
  }
}

function normalizeToolProgress(progress) {
  const value = readRecord(progress);
  const completed = Number(value.completed ?? value.progress ?? 0);
  const total = value.total === undefined ? undefined : Number(value.total);
  if (!Number.isFinite(completed) || (total !== undefined && !Number.isFinite(total))) {
    throw new TypeError("Tool progress values must be finite numbers.");
  }
  return {
    completed,
    total,
    message: readOptionalString(value.message),
  };
}

function readRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function readOptionalString(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function mcpErrorResult(error) {
  const normalized = normalizeToolPluginError(error);
  return {
    content: [{ type: "text", text: normalized.message }],
    structuredContent: { error: normalized },
    isError: true,
  };
}

function normalizeToolPluginError(error) {
  return error instanceof ZodError
    ? {
        code: "InvalidToolArguments",
        message: error.message,
        diagnostics: error.issues.map((issue) => ({
          message: issue.message,
          path: issue.path.filter((part) => typeof part === "string" || typeof part === "number"),
          pointer: zodPathToPointer(issue.path),
        })),
      }
    : {
        code: "PluginExecutionError",
        message: error instanceof Error ? error.message : String(error),
      };
}

function zodPathToPointer(pathParts) {
  return pathParts.length > 0
    ? `/${pathParts.map((part) => String(part).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`
    : undefined;
}

function resolvePluginConfigPath(fileName = "PluginConfig.toml", options = {}) {
  return path.isAbsolute(fileName) ? fileName : path.resolve(options.cwd ?? process.cwd(), fileName);
}

function readPluginTomlConfig(fileName = "PluginConfig.toml", options = {}) {
  const configPath = resolvePluginConfigPath(fileName, options);
  if (!fs.existsSync(configPath)) {
    const exampleHint = options.exampleFileName
      ? ` 请复制 ${options.exampleFileName} 为 ${path.basename(configPath)} 后填写配置。`
      : "";
    throw new Error(`缺少插件配置文件：${configPath}。${exampleHint}`);
  }
  try {
    return parsePluginTomlConfig(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(
      `插件配置文件 TOML 格式错误：${configPath}：${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function parsePluginTomlConfig(content) {
  return parseToml(content);
}

module.exports = {
  runMcpTool,
  runMcpToolSuite,
  parsePluginTomlConfig,
  readPluginTomlConfig,
  resolvePluginConfigPath,
  z,
  ZodError,
};
