"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parse: parseToml } = require("smol-toml");
const { z, ZodError } = require("zod");

const ToolProcessRequestEnvelope = Object.freeze({
  Type: "tool_request",
  Version: 1,
});
const ToolProcessResponseEnvelope = Object.freeze({
  Type: "tool_result",
  Version: 1,
});
const AgentExecutionErrorCodes = {
  InvalidToolArguments: "InvalidToolArguments",
  PluginExecutionError: "PluginExecutionError",
};
const AgentToolProcessErrorPhases = {
  SchemaValidation: "schema_validation",
  RuntimeExecution: "runtime_execution",
};

async function runToolPlugin(definition) {
  return runToolPluginSuite([definition]);
}

async function runToolPluginSuite(definitions) {
  try {
    const request = parseToolCallRequest(await readStdin());
    const definition = definitions.find((item) => item.toolName === request.toolName);
    if (!definition) {
      throw new Error(`不支持的工具：${request.toolName}`);
    }

    const args = definition.argumentSchema.parse(request.arguments);
    const rawResult = await definition.execute(args, request.context);
    const result = definition.resultSchema.parse(rawResult);

    writeResponse(createToolProcessSuccessResponse(result));
  } catch (error) {
    writeResponse(createToolProcessFailureResponse(normalizeToolPluginError(error)));
    process.exitCode = 1;
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseToolCallRequest(input) {
  const parsed = JSON.parse(input);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("工具请求必须是 JSON 对象。");
  }
  if (parsed.type !== ToolProcessRequestEnvelope.Type || parsed.version !== ToolProcessRequestEnvelope.Version) {
    throw new Error(`不支持的工具请求 envelope：type=${String(parsed.type)} version=${String(parsed.version)}。`);
  }

  const args = parsed.arguments;
  return {
    toolName: String(parsed.tool ?? ""),
    arguments: args && typeof args === "object" && !Array.isArray(args) ? args : {},
    context: normalizeToolProcessContext(parsed.context),
  };
}

function normalizeToolProcessContext(value) {
  const context = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    ...context,
    ...Object.fromEntries(
      [
        ["workspaceRoot", process.env.SENERA_TOOL_CONTEXT_WORKSPACE_ROOT],
        ["pluginRoot", process.env.SENERA_TOOL_CONTEXT_PLUGIN_ROOT],
      ].filter((entry) => typeof entry[1] === "string" && entry[1].length > 0),
    ),
  };
}

function writeResponse(response) {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function createToolProcessSuccessResponse(result) {
  return {
    type: ToolProcessResponseEnvelope.Type,
    version: ToolProcessResponseEnvelope.Version,
    ok: true,
    result,
  };
}

function createToolProcessFailureResponse(error) {
  return {
    type: ToolProcessResponseEnvelope.Type,
    version: ToolProcessResponseEnvelope.Version,
    ok: false,
    error,
  };
}

function normalizeToolPluginError(error) {
  return error instanceof ZodError
    ? {
        code: AgentExecutionErrorCodes.InvalidToolArguments,
        message: error.message,
        diagnostics: error.issues.map((issue) => ({
          message: issue.message,
          path: issue.path.filter((part) => typeof part === "string" || typeof part === "number"),
          pointer: zodPathToPointer(issue.path),
        })),
        details: {
          phase: AgentToolProcessErrorPhases.SchemaValidation,
          issues: error.issues,
        },
      }
    : {
        code: AgentExecutionErrorCodes.PluginExecutionError,
        message: error instanceof Error ? error.message : String(error),
        diagnostics: normalizeRuntimeDiagnostics(error) ?? [
          {
            message: error instanceof Error ? error.message : String(error),
            path: [],
            pointer: "/",
          },
        ],
        details: {
          phase: AgentToolProcessErrorPhases.RuntimeExecution,
        },
      };
}

function normalizeRuntimeDiagnostics(error) {
  if (!error || typeof error !== "object" || !("diagnostics" in error)) {
    return undefined;
  }
  return Array.isArray(error.diagnostics)
    ? error.diagnostics.filter((item) => Boolean(item) && typeof item === "object" && "message" in item)
    : undefined;
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
  runToolPlugin,
  runToolPluginSuite,
  ToolProcessRequestEnvelope,
  ToolProcessResponseEnvelope,
  createToolProcessSuccessResponse,
  createToolProcessFailureResponse,
  parsePluginTomlConfig,
  readPluginTomlConfig,
  resolvePluginConfigPath,
  z,
  ZodError,
};
