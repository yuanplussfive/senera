"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { InMemoryTaskStore } = require("@modelcontextprotocol/sdk/experimental/tasks");
const { parse: parseToml, stringify: stringifyToml } = require("smol-toml");
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

const ToolContractVersion = 1;

/**
 * Declares a plugin configuration once. The returned definition drives both
 * plugin-side Zod validation and the static TOML artifacts consumed by the
 * host configuration UI.
 */
function definePluginConfiguration(definition) {
  const value = readRecord(definition);
  const schema = value.schema;
  const defaults = value.defaults;
  const form = readRecord(value.form);
  if (!schema || typeof schema.parse !== "function") {
    throw new TypeError("Plugin configuration requires a Zod schema.");
  }
  if (!isTomlTable(defaults)) {
    throw new TypeError("Plugin configuration defaults must be a TOML table.");
  }
  if (!Array.isArray(form.sections)) {
    throw new TypeError("Plugin configuration form requires sections.");
  }

  // Reject a template that cannot be consumed by the plugin before it ever
  // reaches a user plugin directory.
  schema.parse(defaults);
  assertTomlValue(defaults, []);
  assertPluginConfigurationForm(form);

  return Object.freeze({
    schema,
    defaults: deepFreeze(defaults),
    form: deepFreeze({
      version: form.version ?? 1,
      strict: form.strict !== false,
      sections: form.sections.map(normalizePluginConfigurationSection),
      ...(Array.isArray(form.allowedPaths) ? { allowedPaths: form.allowedPaths.map(normalizeAllowedPath) } : {}),
    }),
  });
}

function createPluginConfigurationArtifacts(configuration) {
  const definition = definePluginConfiguration(configuration);
  const schema = {
    form: definition.form,
  };
  return deepFreeze({
    schemaToml: ensureTrailingNewline(stringifyToml(schema)),
    exampleToml: renderPluginConfigurationExample(definition),
  });
}

function renderPluginConfigurationExample(definition) {
  const annotations = new Map(
    definition.form.sections.flatMap((section) =>
      section.fields.map((field) => [
        field.path.join("\u0000"),
        field.description ? `${field.label}: ${field.description}` : field.label,
      ]),
    ),
  );
  const lines = [];
  renderTomlTable(lines, definition.defaults, [], annotations, []);
  const document = ensureTrailingNewline(lines.join("\n"));
  const parsed = parseToml(document);
  if (stableJson(parsed) !== stableJson(definition.defaults)) {
    throw new Error("Plugin configuration example renderer did not preserve the declared defaults.");
  }
  return document;
}

/**
 * Produces TOML directly from the declaration tree. It deliberately never
 * interprets serialized TOML: comments remain associated with their source
 * field path even when a table has no direct scalar values.
 */
function renderTomlTable(lines, table, pathParts, annotations, tableAnnotations) {
  const entries = Object.entries(assertTomlTable(table, pathParts));
  const scalarEntries = entries.filter(([, value]) => !isTomlTable(value));
  const nestedEntries = entries.filter(([, value]) => isTomlTable(value));
  const writesHeader = pathParts.length > 0 && (scalarEntries.length > 0 || entries.length === 0);

  if (writesHeader) {
    appendTomlSectionSeparator(lines);
    tableAnnotations.forEach((annotation) => appendTomlAnnotation(lines, annotation));
    lines.push(`[${pathParts.map(formatTomlKey).join(".")}]`);
  }
  for (const [key, value] of scalarEntries) {
    appendTomlAnnotation(lines, annotations.get([...pathParts, key].join("\u0000")));
    lines.push(`${formatTomlKey(key)} = ${formatTomlValue(value, [...pathParts, key])}`);
  }

  for (const [index, [key, value]] of nestedEntries.entries()) {
    const nestedAnnotations = [
      ...(!writesHeader && index === 0 ? tableAnnotations : []),
      annotations.get([...pathParts, key].join("\u0000")),
    ].filter(Boolean);
    renderTomlTable(lines, value, [...pathParts, key], annotations, nestedAnnotations);
  }
}

function appendTomlSectionSeparator(lines) {
  if (lines.length > 0 && lines.at(-1) !== "") lines.push("");
}

function appendTomlAnnotation(lines, annotation) {
  if (!annotation) return;
  if (/\r|\n/u.test(annotation)) {
    throw new TypeError("Plugin configuration field labels and descriptions must be single-line text.");
  }
  lines.push(`# ${annotation}`);
}

function assertTomlTable(value, pathParts) {
  if (isTomlTable(value)) return value;
  const path = pathParts.length === 0 ? "defaults" : pathParts.join(".");
  throw new TypeError(`Plugin configuration ${path} must be a TOML table.`);
}

function isTomlTable(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function formatTomlKey(value) {
  return /^[A-Za-z0-9_-]+$/u.test(value) ? value : JSON.stringify(value);
}

function formatTomlValue(value, pathParts) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Plugin configuration ${pathParts.join(".")} must not contain a non-finite number.`);
    }
    return Object.is(value, -0) ? "-0" : String(value);
  }
  if (Array.isArray(value)) {
    return `[ ${value.map((item, index) => formatTomlValue(item, [...pathParts, String(index)])).join(", ")} ]`;
  }
  if (isTomlTable(value)) {
    return `{ ${Object.entries(value)
      .map(([key, nested]) => `${formatTomlKey(key)} = ${formatTomlValue(nested, [...pathParts, key])}`)
      .join(", ")} }`;
  }
  throw new TypeError(`Plugin configuration ${pathParts.join(".")} contains an unsupported TOML value.`);
}

function assertTomlValue(value, pathParts) {
  if (typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw new TypeError(`Plugin configuration ${pathParts.join(".")} must not contain a non-finite number.`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertTomlValue(item, [...pathParts, String(index)]));
    return;
  }
  if (isTomlTable(value)) {
    Object.entries(value).forEach(([key, nested]) => assertTomlValue(nested, [...pathParts, key]));
    return;
  }
  throw new TypeError(`Plugin configuration ${pathParts.join(".")} contains an unsupported TOML value.`);
}

function assertPluginConfigurationForm(form) {
  const paths = new Set();
  for (const section of form.sections) {
    const normalized = normalizePluginConfigurationSection(section);
    for (const field of normalized.fields) {
      const key = field.path.join("\u0000");
      if (paths.has(key)) throw new Error(`Duplicate plugin configuration field path: ${field.path.join(".")}`);
      paths.add(key);
    }
  }
}

function normalizePluginConfigurationSection(value) {
  const section = readRecord(value);
  const id = readOptionalString(section.id);
  const label = readOptionalString(section.label);
  if (!id || !label || !Array.isArray(section.fields)) {
    throw new TypeError("Plugin configuration sections require id, label, and fields.");
  }
  return {
    id,
    label,
    ...(readOptionalString(section.description) ? { description: section.description } : {}),
    ...(section.level === "internal" ? { level: "internal" } : {}),
    fields: section.fields.map(normalizePluginConfigurationField),
  };
}

function normalizePluginConfigurationField(value) {
  const field = readRecord(value);
  const pathValue = Array.isArray(field.path) ? field.path : [];
  const path = pathValue.map((part) => (typeof part === "string" ? part.trim() : ""));
  const label = readOptionalString(field.label);
  const type = readOptionalString(field.type);
  if (path.length === 0 || path.some((part) => !part) || !label || !type) {
    throw new TypeError("Plugin configuration fields require a non-empty path, label, and type.");
  }
  if (!["boolean", "string", "number", "array", "table"].includes(type)) {
    throw new TypeError(`Unsupported plugin configuration field type: ${type}`);
  }
  const options = Array.isArray(field.options)
    ? field.options.filter((item) => typeof item === "string" || typeof item === "number" || typeof item === "boolean")
    : undefined;
  const itemType = readOptionalString(field.itemType);
  if (itemType && !["boolean", "string", "number", "table"].includes(itemType)) {
    throw new TypeError(`Unsupported plugin configuration array item type: ${itemType}`);
  }
  return {
    path,
    label,
    type,
    ...(readOptionalString(field.description) ? { description: field.description } : {}),
    ...(readOptionalString(field.placeholder) ? { placeholder: field.placeholder } : {}),
    ...(itemType ? { itemType } : {}),
    ...(options && options.length > 0 ? { options } : {}),
    ...(isRecord(field.optionLabels) ? { optionLabels: field.optionLabels } : {}),
    ...(typeof field.min === "number" ? { min: field.min } : {}),
    ...(typeof field.max === "number" ? { max: field.max } : {}),
    ...(typeof field.step === "number" ? { step: field.step } : {}),
    ...(field.secret === true ? { secret: true } : {}),
    ...(field.multiline === true ? { multiline: true } : {}),
    ...(type === "boolean" || typeof field.required === "boolean"
      ? { required: type === "boolean" || field.required === true }
      : {}),
  };
}

function normalizeAllowedPath(value) {
  const pathValue = Array.isArray(value?.path) ? value.path : [];
  const path = pathValue.map((part) => (typeof part === "string" ? part.trim() : ""));
  if (path.length === 0 || path.some((part) => !part)) {
    throw new TypeError("Plugin configuration allowed paths require a non-empty path.");
  }
  return {
    path,
    ...(value?.recursive === true ? { recursive: true } : {}),
  };
}

function ensureTrailingNewline(value) {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function createToolContractBundle(definitions, options = {}) {
  const sourceIdentity = readOptionalString(options.sourceIdentity);
  const sourceFile = readOptionalString(options.sourceFile);
  if (options.sourceIdentity !== undefined && !sourceIdentity) {
    throw new TypeError("sourceIdentity must be a non-empty string when provided.");
  }
  if (options.sourceFile !== undefined && !sourceFile) {
    throw new TypeError("sourceFile must be a non-empty string when provided.");
  }

  const tools = {};
  for (const definition of definitions) {
    const toolName = readOptionalString(definition?.toolName);
    if (!toolName) throw new TypeError("Every tool contract definition must have a non-empty toolName.");
    if (Object.hasOwn(tools, toolName)) throw new Error(`Duplicate tool contract definition: ${toolName}`);

    const inputSchema = z.toJSONSchema(definition.argumentSchema, { target: "draft-7" });
    const outputSchema = z.toJSONSchema(definition.resultSchema, { target: "draft-7" });
    const schemaDigest = stableJson({ inputSchema, outputSchema });
    tools[toolName] = {
      source: {
        kind: "schema",
        identity: sourceIdentity ? `${sourceIdentity}#${toolName}` : toolName,
        ...(sourceFile ? { file: sourceFile } : {}),
        sha256: crypto.createHash("sha256").update(schemaDigest).digest("hex"),
      },
      inputSchema,
      outputSchema,
    };
  }
  return deepFreeze({ contractVersion: ToolContractVersion, tools });
}

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

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function readOptionalString(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stableJson(value) {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortJsonValue(nested)]),
  );
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
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
  ToolContractVersion,
  createToolContractBundle,
  createPluginConfigurationArtifacts,
  definePluginConfiguration,
  runMcpTool,
  runMcpToolSuite,
  parsePluginTomlConfig,
  readPluginTomlConfig,
  resolvePluginConfigPath,
  z,
  ZodError,
};
