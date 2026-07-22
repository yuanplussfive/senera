import { z } from "zod";
import type { AgentExecutionResourceBroker } from "../ExecutionResources/AgentExecutionResourceBroker.js";
import { AgentExecutionResourceError } from "../ExecutionResources/AgentExecutionResourceError.js";
import { AgentExecutionResourceSignals } from "../ExecutionResources/AgentExecutionResourceTypes.js";
import { SeneraShellCommandSpecSchema } from "../Execution/SeneraShellCommand.js";
import { SeneraTerminalDimensionLimits } from "../Execution/SeneraTerminalTypes.js";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";
import type { AgentHostToolContext, AgentHostToolHandler } from "./AgentToolHostCapabilityRegistry.js";
import { toolProcessFailureResult, toolProcessSuccessResult } from "./AgentToolProcessEnvelope.js";
import { createAgentShellExecutionProfile } from "./AgentShellCommandRuntime.js";
import { resolveAgentExecutionResourceWaitTimeoutMs } from "../ExecutionResources/AgentExecutionResourceConfig.js";

const ResourceIdSchema = z
  .string()
  .trim()
  .regex(/^res_[a-f0-9]{32}$/i);

const ShellStartArgumentsSchema = z
  .object({
    command: SeneraShellCommandSpecSchema,
    cwd: z.string().trim().min(1).optional(),
    justification: z.string().trim().min(1).optional(),
    columns: z.coerce
      .number()
      .int()
      .min(SeneraTerminalDimensionLimits.minColumns)
      .max(SeneraTerminalDimensionLimits.maxColumns)
      .optional(),
    rows: z.coerce
      .number()
      .int()
      .min(SeneraTerminalDimensionLimits.minRows)
      .max(SeneraTerminalDimensionLimits.maxRows)
      .optional(),
  })
  .strict();

const ResourceInspectArgumentsSchema = z
  .object({
    resourceId: ResourceIdSchema,
    cursor: z.coerce.number().int().min(0).optional(),
  })
  .strict();

const ResourceWaitArgumentsSchema = ResourceInspectArgumentsSchema.extend({
  timeoutMs: z.coerce.number().int().min(0).optional(),
}).strict();

const ResourceWriteArgumentsSchema = z
  .object({
    resourceId: ResourceIdSchema,
    input: z.string(),
    appendNewline: z.boolean().optional(),
  })
  .strict();

const ResourceSignalArgumentsSchema = z
  .object({
    resourceId: ResourceIdSchema,
    signal: z.enum([
      AgentExecutionResourceSignals.Interrupt,
      AgentExecutionResourceSignals.Terminate,
      AgentExecutionResourceSignals.Kill,
    ]),
  })
  .strict();

const ResourceListArgumentsSchema = z.object({}).strict();

const ResourceResizeArgumentsSchema = z
  .object({
    resourceId: ResourceIdSchema,
    columns: z.coerce
      .number()
      .int()
      .min(SeneraTerminalDimensionLimits.minColumns)
      .max(SeneraTerminalDimensionLimits.maxColumns),
    rows: z.coerce.number().int().min(SeneraTerminalDimensionLimits.minRows).max(SeneraTerminalDimensionLimits.maxRows),
  })
  .strict();

export interface AgentExecutionResourceHostHandlers {
  startShell: AgentHostToolHandler;
  inspect: AgentHostToolHandler;
  wait: AgentHostToolHandler;
  write: AgentHostToolHandler;
  signal: AgentHostToolHandler;
  list: AgentHostToolHandler;
  resize: AgentHostToolHandler;
  stopAll: AgentHostToolHandler;
}

export function createAgentExecutionResourceHostHandlers(
  broker: AgentExecutionResourceBroker,
): AgentExecutionResourceHostHandlers {
  return {
    startShell: withValidatedArguments(ShellStartArgumentsSchema, async (args, context) => {
      const cwdResult = await context.executionEnv.canonicalPath(args.cwd ?? ".");
      if (!cwdResult.ok) throw cwdResult.error;
      const profile = createAgentShellExecutionProfile(context.tool, requireExecutionPlan(context));
      const snapshot = await broker.startTerminal({
        command: args.command.script,
        args: [],
        shellCommand: args.command,
        displayCommand: args.command.script,
        cwd: cwdResult.value,
        executionEnv: context.executionEnv,
        profile,
        owner: resourceOwner(context),
        correlation: {
          sessionId: context.sessionId,
          requestId: context.requestId,
          step: context.step,
          toolCallId: context.toolCallId,
          toolName: context.tool.name,
          onEvent: context.onEvent,
        },
        signal: context.signal,
        dimensions: {
          columns: args.columns,
          rows: args.rows,
        },
      });
      return snapshot;
    }),
    inspect: withValidatedArguments(ResourceInspectArgumentsSchema, (args, context) =>
      broker.inspect(args.resourceId, resourceOwner(context), args.cursor),
    ),
    wait: withValidatedArguments(ResourceWaitArgumentsSchema, (args, context) =>
      broker.wait(
        args.resourceId,
        resourceOwner(context),
        args.cursor ?? 0,
        resolveAgentExecutionResourceWaitTimeoutMs(context.config, args.timeoutMs),
        context.signal,
      ),
    ),
    write: withValidatedArguments(ResourceWriteArgumentsSchema, (args, context) => {
      const input = args.appendNewline ? `${args.input}${process.platform === "win32" ? "\r\n" : "\n"}` : args.input;
      return broker.write(args.resourceId, resourceOwner(context), Buffer.from(input, "utf8"));
    }),
    signal: withValidatedArguments(ResourceSignalArgumentsSchema, (args, context) =>
      broker.signal(args.resourceId, resourceOwner(context), args.signal),
    ),
    list: withValidatedArguments(ResourceListArgumentsSchema, (_args, context) => ({
      resources: broker.list(resourceOwner(context)),
    })),
    resize: withValidatedArguments(ResourceResizeArgumentsSchema, (args, context) =>
      broker.resize(args.resourceId, resourceOwner(context), {
        columns: args.columns,
        rows: args.rows,
      }),
    ),
    stopAll: withValidatedArguments(ResourceListArgumentsSchema, async (_args, context) => ({
      resources: await broker.stopAll(resourceOwner(context)),
    })),
  };
}

function requireExecutionPlan(context: AgentHostToolContext) {
  if (!context.executionPlan) {
    throw new Error(`Tool ${context.tool.name} is missing its resolved execution plan.`);
  }
  return context.executionPlan;
}

function withValidatedArguments<TSchema extends z.ZodType<Record<string, unknown>>>(
  schema: TSchema,
  execute: (args: z.output<TSchema>, context: AgentHostToolContext) => unknown | Promise<unknown>,
): AgentHostToolHandler {
  return async (args, context) => {
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      return toolProcessFailureResult({
        code: AgentExecutionErrorCodes.InvalidToolArguments,
        message: `Invalid arguments for ${context.tool.name}.`,
        details: {
          phase: AgentToolProcessErrorPhases.RuntimeExecution,
          issues: parsed.error.issues,
        },
      });
    }
    try {
      return toolProcessSuccessResult(await execute(parsed.data, context));
    } catch (error) {
      return toolProcessFailureResult({
        code: AgentExecutionErrorCodes.PluginExecutionError,
        message: error instanceof Error ? error.message : String(error),
        details: {
          phase: AgentToolProcessErrorPhases.RuntimeExecution,
          resourceCode: error instanceof AgentExecutionResourceError ? error.code : undefined,
        },
      });
    }
  };
}

function resourceOwner(context: AgentHostToolContext) {
  return {
    workspaceRoot: context.workspaceRoot,
    sessionId: context.sessionId,
    requestId: context.requestId,
  };
}
