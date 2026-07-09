import { ZodError, type ZodType } from "zod";
import {
  createToolProcessFailureResponse,
  createToolProcessSuccessResponse,
} from "./AgentToolProcessEnvelope.js";
import {
  AgentToolProcessRequestEnvelope,
  type AgentToolProcessRequestEnvelopeDocument,
} from "./AgentToolProcessRequestEnvelope.js";
import type {
  AgentSourceDiagnostic,
} from "../Diagnostics/AgentSourceDiagnostic.js";
import type { AgentToolProcessContext, AgentToolProcessResponse } from "../Types/ToolRuntimeTypes.js";
import {
  AgentExecutionErrorCodes,
  AgentToolProcessErrorPhases,
} from "../Xml/AgentXmlStatus.js";

export interface ToolPluginDefinition<TArguments, TResult> {
  toolName: string;
  argumentSchema: ZodType<TArguments>;
  resultSchema: ZodType<TResult>;
  execute: (args: TArguments, context: AgentToolProcessContext) => Promise<TResult> | TResult;
}

type RunnableToolPluginDefinition = {
  toolName: string;
  argumentSchema: ZodType;
  resultSchema: ZodType;
  execute: (args: unknown, context: AgentToolProcessContext) => Promise<unknown> | unknown;
};

export interface ToolPluginRuntimeOptions {}

export async function runToolPlugin<TArguments, TResult>(
  definition: ToolPluginDefinition<TArguments, TResult>,
  options: ToolPluginRuntimeOptions = {},
): Promise<void> {
  return runToolPluginSuite([definition as RunnableToolPluginDefinition], options);
}

export async function runToolPluginSuite(
  definitions: readonly RunnableToolPluginDefinition[],
  options: ToolPluginRuntimeOptions = {},
): Promise<void> {
  try {
    const request = parseToolCallRequest(await readStdin(), options);
    const definition = definitions.find((item) => item.toolName === request.toolName);
    if (!definition) {
      throw new Error(`不支持的工具：${request.toolName}`);
    }

    const args = definition.argumentSchema.parse(request.arguments);
    const rawResult = await definition.execute(args, request.context);
    const result = definition.resultSchema.parse(rawResult);

    writeResponse(createToolProcessSuccessResponse(result));
  } catch (error: unknown) {
    writeResponse(createToolProcessFailureResponse(normalizeToolPluginError(error)));
    process.exitCode = 1;
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

function parseToolCallRequest(
  input: string,
  options: ToolPluginRuntimeOptions,
): {
  toolName: string;
  arguments: Record<string, unknown>;
  context: AgentToolProcessContext;
} {
  const parsed = JSON.parse(input) as Partial<AgentToolProcessRequestEnvelopeDocument>;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("工具请求必须是 JSON 对象。");
  }
  if (parsed.type !== AgentToolProcessRequestEnvelope.Type || parsed.version !== AgentToolProcessRequestEnvelope.Version) {
    throw new Error(`不支持的工具请求 envelope：type=${String(parsed.type)} version=${String(parsed.version)}。`);
  }

  return {
    toolName: String(parsed.tool ?? ""),
    arguments:
      parsed.arguments && typeof parsed.arguments === "object" && !Array.isArray(parsed.arguments)
        ? parsed.arguments
        : {},
    context: normalizeToolProcessContext(parsed.context),
  };
}

function normalizeToolProcessContext(value: unknown): AgentToolProcessContext {
  const context = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<AgentToolProcessContext>
    : {};
  return {
    workspaceRoot: process.env.SENERA_TOOL_CONTEXT_WORKSPACE_ROOT ?? context.workspaceRoot ?? "",
    pluginRoot: process.env.SENERA_TOOL_CONTEXT_PLUGIN_ROOT ?? context.pluginRoot ?? "",
  };
}

function writeResponse(response: AgentToolProcessResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function normalizeToolPluginError(
  error: unknown,
): NonNullable<AgentToolProcessResponse["error"]> {
  return error instanceof ZodError
    ? {
        code: AgentExecutionErrorCodes.InvalidToolArguments,
        message: error.message,
        diagnostics: error.issues.map((issue) => ({
          message: issue.message,
          path: issue.path.filter((part): part is string | number =>
            typeof part === "string" || typeof part === "number"),
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
        diagnostics: normalizeRuntimeDiagnostics(error)
          ?? [{
              message: error instanceof Error ? error.message : String(error),
              path: [],
              pointer: "/",
            }],
        details: {
          phase: AgentToolProcessErrorPhases.RuntimeExecution,
        },
      };
}

function normalizeRuntimeDiagnostics(error: unknown): AgentSourceDiagnostic[] | undefined {
  if (!error || typeof error !== "object" || !("diagnostics" in error)) {
    return undefined;
  }

  const diagnostics = (error as { diagnostics?: unknown }).diagnostics;
  return Array.isArray(diagnostics)
    ? diagnostics.filter((item): item is AgentSourceDiagnostic =>
        Boolean(item) && typeof item === "object" && "message" in item)
    : undefined;
}

function zodPathToPointer(path: PropertyKey[]): string | undefined {
  return path.length > 0
    ? `/${path.map((part) => String(part).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`
    : undefined;
}
