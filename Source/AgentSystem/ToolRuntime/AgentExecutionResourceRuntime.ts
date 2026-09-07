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
import { errorMessage } from "../Core/AgentErrors.js";
import type { AgentToolProcessRunResult } from "./AgentToolProcessTypes.js";
import {
  AgentExecutionResourcePurposes,
  type AgentExecutionResourceSnapshot,
} from "../ExecutionResources/AgentExecutionResourceTypes.js";

const ResourceIdSchema = z
  .string()
  .trim()
  .regex(/^res_[a-f0-9]{32}$/i);

const TerminalStartArgumentsSchema = z
  .object({
    command: SeneraShellCommandSpecSchema,
    cwd: z.string().trim().min(1).optional(),
    justification: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1).max(80).optional(),
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
  startTerminal: AgentHostToolHandler;
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
    startTerminal: withValidatedArguments(TerminalStartArgumentsSchema, (args, context) =>
      startTerminalResource(broker, args, context),
    ),
    inspect: withValidatedArguments(
      ResourceInspectArgumentsSchema,
      (args, context) => broker.inspect(args.resourceId, resourceOwner(context), args.cursor),
      (snapshot, context) => resourceSnapshotResult(broker, snapshot, context),
    ),
    wait: withValidatedArguments(
      ResourceWaitArgumentsSchema,
      (args, context) =>
        broker.wait(
          args.resourceId,
          resourceOwner(context),
          args.cursor ?? 0,
          resolveAgentExecutionResourceWaitTimeoutMs(context.config, args.timeoutMs),
          context.signal,
        ),
      (snapshot, context) => resourceSnapshotResult(broker, snapshot, context),
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

async function startTerminalResource(
  broker: AgentExecutionResourceBroker,
  args: {
    command: z.output<typeof SeneraShellCommandSpecSchema>;
    cwd?: string;
    justification?: string;
    title?: string;
    columns?: number;
    rows?: number;
  },
  context: AgentHostToolContext,
) {
  const cwdResult = await context.executionEnv.canonicalPath(args.cwd ?? ".");
  if (!cwdResult.ok) throw cwdResult.error;
  const profile = createAgentShellExecutionProfile(requireExecutionPlan(context));
  const request = {
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
    presentation: {
      purpose: AgentExecutionResourcePurposes.CommandTask,
      title: args.title,
    },
  } as const;
  return broker.startTerminal({
    ...request,
    dimensions: { columns: args.columns, rows: args.rows },
  });
}

function withValidatedArguments<TSchema extends z.ZodType<Record<string, unknown>>, TResult>(
  schema: TSchema,
  execute: (args: z.output<TSchema>, context: AgentHostToolContext) => TResult | Promise<TResult>,
  projectResult: (result: TResult, context: AgentHostToolContext) => AgentToolProcessRunResult = (result) =>
    toolProcessSuccessResult(result),
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
      return projectResult(await execute(parsed.data, context), context);
    } catch (error) {
      return toolProcessFailureResult({
        code: AgentExecutionErrorCodes.ToolExecutionError,
        message: errorMessage(error),
        details: {
          phase: AgentToolProcessErrorPhases.RuntimeExecution,
          resourceCode: error instanceof AgentExecutionResourceError ? error.code : undefined,
        },
      });
    }
  };
}

function resourceSnapshotResult(
  broker: AgentExecutionResourceBroker,
  snapshot: AgentExecutionResourceSnapshot,
  context: AgentHostToolContext,
): AgentToolProcessRunResult {
  const result = toolProcessSuccessResult(snapshot);
  const outputCapture = broker.takeOutputCapture(snapshot.resourceId, resourceOwner(context));
  return outputCapture ? { ...result, outputCapture } : result;
}

function resourceOwner(context: AgentHostToolContext) {
  return {
    workspaceRoot: context.workspaceRoot,
    sessionId: context.sessionId,
    requestId: context.requestId,
  };
}
