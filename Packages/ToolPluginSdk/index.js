"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { XMLParser } = require("fast-xml-parser");
const { parse: parseToml } = require("smol-toml");
const { z, ZodError } = require("zod");

const AgentToolProcessProtocol = "AgentToolProcess.v1";
const AgentExecutionErrorCodes = {
  InvalidToolArguments: "InvalidToolArguments",
  PluginExecutionError: "PluginExecutionError"
};
const AgentToolProcessErrorPhases = {
  SchemaValidation: "schema_validation",
  RuntimeExecution: "runtime_execution"
};
const DefaultXmlProtocolSpec = {
  roots: {
    toolCalls: "tool_calls"
  },
  items: {
    toolCall: "tool_call",
    arrayItem: "item"
  },
  toolCall: {
    name: "name",
    arguments: "arguments"
  },
  arrayElementNameSuffix: "_item"
};

async function runToolPlugin(definition, options = {}) {
  return runToolPluginSuite([definition], options);
}

async function runToolPluginSuite(definitions, options = {}) {
  try {
    const request = parseToolCallRequest(await readStdin(), options);
    const definition = definitions.find((item) => item.toolName === request.toolName);
    if (!definition) {
      throw new Error(`不支持的工具：${request.toolName}`);
    }

    const args = definition.argumentSchema.parse(request.arguments);
    const rawResult = await definition.execute(args);
    const result = definition.resultSchema.parse(rawResult);

    writeResponse({
      protocol: AgentToolProcessProtocol,
      ok: true,
      result
    });
  } catch (error) {
    writeResponse({
      protocol: AgentToolProcessProtocol,
      ok: false,
      error: normalizeToolPluginError(error)
    });
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

function parseToolCallRequest(input, options) {
  const protocol = options.protocol ?? DefaultXmlProtocolSpec;
  const parsed = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false,
    alwaysCreateTextNode: false,
    cdataPropName: "#cdata",
    isArray: (name) => isArrayElementName(name, protocol, options)
  }).parse(input);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("工具请求不是 XML 对象。");
  }

  const value = normalizeXmlValue(parsed[protocol.roots.toolCalls]);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`不支持的工具请求根标签，期望 ${protocol.roots.toolCalls}。`);
  }

  const toolCalls = value[protocol.items.toolCall];
  const [call] = Array.isArray(toolCalls) ? toolCalls : [];
  if (!call || typeof call !== "object" || Array.isArray(call)) {
    throw new Error(`工具请求缺少 ${protocol.items.toolCall}。`);
  }

  const args = call[protocol.toolCall.arguments];
  return {
    toolName: String(call[protocol.toolCall.name] ?? ""),
    arguments:
      args && typeof args === "object" && !Array.isArray(args)
        ? args
        : {}
  };
}

function normalizeXmlValue(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeXmlValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const entries = Object.entries(value);
  if (entries.length === 1 && entries[0][0] === "#cdata") {
    return entries[0][1];
  }

  return Object.fromEntries(
    entries.map(([key, item]) => [key, normalizeXmlValue(item)])
  );
}

function isArrayElementName(name, protocol, options) {
  return new Set([
    protocol.items.arrayItem,
    protocol.items.toolCall,
    ...(options.arrayElementNames ?? [])
  ]).has(name) || name.endsWith(options.arrayElementNameSuffix ?? protocol.arrayElementNameSuffix);
}

function writeResponse(response) {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function normalizeToolPluginError(error) {
  return error instanceof ZodError
    ? {
      code: AgentExecutionErrorCodes.InvalidToolArguments,
      message: error.message,
      diagnostics: error.issues.map((issue) => ({
        message: issue.message,
        path: issue.path.filter((part) => typeof part === "string" || typeof part === "number"),
        pointer: zodPathToPointer(issue.path)
      })),
      details: {
        phase: AgentToolProcessErrorPhases.SchemaValidation,
        issues: error.issues
      }
    }
    : {
      code: AgentExecutionErrorCodes.PluginExecutionError,
      message: error instanceof Error ? error.message : String(error),
      diagnostics: normalizeRuntimeDiagnostics(error)
        ?? [{
          message: error instanceof Error ? error.message : String(error),
          path: [],
          pointer: "/"
        }],
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution
      }
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
  return path.isAbsolute(fileName)
    ? fileName
    : path.resolve(options.cwd ?? process.cwd(), fileName);
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
      { cause: error }
    );
  }
}

function parsePluginTomlConfig(content) {
  return parseToml(content);
}

module.exports = {
  runToolPlugin,
  runToolPluginSuite,
  parsePluginTomlConfig,
  readPluginTomlConfig,
  resolvePluginConfigPath,
  z,
  ZodError
};
