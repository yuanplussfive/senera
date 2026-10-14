import { z } from "zod";
import type { AgentExecutionResourceBroker } from "../ExecutionResources/AgentExecutionResourceBroker.js";
import { AgentExecutionResourceError } from "../ExecutionResources/AgentExecutionResourceError.js";
import {
  AgentExecutionResourceSignals,
  AgentExecutionResourceStates,
} from "../ExecutionResources/AgentExecutionResourceTypes.js";
import { SeneraShellCommandSpecSchema } from "../Execution/SeneraShellCommand.js";
import { SeneraTerminalDimensionLimits } from "../Execution/SeneraTerminalTypes.js";
import { AgentWorkspaceEffectSchema, AgentWorkspaceEffects } from "../Artifacts/AgentWorkspaceObservationIntent.js";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";
import type { AgentHostToolContext, AgentHostToolHandler } from "./AgentToolHostCapabilityRegistry.js";
import { toolProcessFailureResult, toolProcessSuccessResult } from "./AgentToolProcessEnvelope.js";
import { createAgentShellExecutionProfile } from "./AgentShellCommandRuntime.js";
import { resolveAgentExecutionResourceWaitTimeoutMs } from "../ExecutionResources/AgentExecutionResourceConfig.js";
import { errorMessage } from "../Core/AgentErrors.js";
import type { AgentToolProcessRunResult } from "./AgentToolProcessTypes.js";
import {
  AgentExecutionResourcePurposes,
  type AgentExecutionResourceOwner,
  type AgentExecutionResourceSnapshot,
} from "../ExecutionResources/AgentExecutionResourceTypes.js";
import {
  AgentExecutionResourceCursorLedger,
  projectAgentExecutionResourceCollection,
  projectAgentExecutionResourceResult,
} from "./AgentExecutionResourceResultProjector.js";

const ResourceIdSchema = z
  .string()
  .trim()
  .regex(/^res_[a-f0-9]{32}$/i);

const TerminalStartArgumentsSchema = z
  .object({
    ...SeneraShellCommandSpecSchema.shape,
    cwd: z.string().trim().min(1).optional(),
    workspaceEffect: AgentWorkspaceEffectSchema,
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

interface ResourceObservation {
  readonly snapshot: AgentExecutionResourceSnapshot;
  readonly fromCursor: number;
  readonly includeInvocation?: boolean;
}

export function createAgentExecutionResourceHostHandlers(
  broker: AgentExecutionResourceBroker,
): AgentExecutionResourceHostHandlers {
  const cursors = new AgentExecutionResourceCursorLedger();
  return {
    startTerminal: withValidatedArguments(
      TerminalStartArgumentsSchema,
      async (args, context) => {
        const snapshot = await startTerminalResource(broker, args, context);
        cursors.record(resourceOwner(context), snapshot);
        return { snapshot, fromCursor: snapshot.cursor, includeInvocation: true } satisfies ResourceObservation;
      },
      (value, context) => resourceSnapshotResult(broker, value, context),
    ),
    inspect: withValidatedArguments(
      ResourceInspectArgumentsSchema,
      (args, context) => inspectResource(broker, cursors, args.resourceId, args.cursor, context),
      (value, context) => resourceSnapshotResult(broker, value, context),
    ),
    wait: withValidatedArguments(
      ResourceWaitArgumentsSchema,
      (args, context) =>
        waitForResource(
          broker,
          cursors,
          args.resourceId,
          args.cursor,
          resolveAgentExecutionResourceWaitTimeoutMs(context.config, args.timeoutMs),
          context,
        ),
      (value, context) => resourceSnapshotResult(broker, value, context),
    ),
    write: withValidatedArguments(
      ResourceWriteArgumentsSchema,
      async (args, context) => {
        const input = args.appendNewline ? `${args.input}${process.platform === "win32" ? "\r\n" : "\n"}` : args.input;
        const snapshot = await broker.write(args.resourceId, resourceOwner(context), Buffer.from(input, "utf8"));
        cursors.record(resourceOwner(context), snapshot);
        return { snapshot, fromCursor: snapshot.cursor } satisfies ResourceObservation;
      },
      (value, context) => resourceSnapshotResult(broker, value, context),
    ),
    signal: withValidatedArguments(
      ResourceSignalArgumentsSchema,
      async (args, context) => {
        const snapshot = await broker.signal(args.resourceId, resourceOwner(context), args.signal);
        cursors.record(resourceOwner(context), snapshot);
        return { snapshot, fromCursor: snapshot.cursor } satisfies ResourceObservation;
      },
      (value, context) => resourceSnapshotResult(broker, value, context),
    ),
    list: withValidatedArguments(ResourceListArgumentsSchema, (_args, context) => ({
      resources: projectAgentExecutionResourceCollection(broker.list(resourceOwner(context))).resources,
    })),
    resize: withValidatedArguments(
      ResourceResizeArgumentsSchema,
      async (args, context) => {
        const snapshot = await broker.resize(args.resourceId, resourceOwner(context), {
          columns: args.columns,
          rows: args.rows,
        });
        cursors.record(resourceOwner(context), snapshot);
        return { snapshot, fromCursor: snapshot.cursor } satisfies ResourceObservation;
      },
      (value, context) => resourceSnapshotResult(broker, value, context),
    ),
    stopAll: withValidatedArguments(ResourceListArgumentsSchema, async (_args, context) => {
      const snapshots = await broker.stopAll(resourceOwner(context));
      snapshots.forEach((snapshot) => cursors.record(resourceOwner(context), snapshot));
      return projectAgentExecutionResourceCollection(snapshots);
    }),
  };
}

function inspectResource(
  broker: AgentExecutionResourceBroker,
  cursors: AgentExecutionResourceCursorLedger,
  resourceId: string,
  explicitCursor: number | undefined,
  context: AgentHostToolContext,
): ResourceObservation {
  const owner = resourceOwner(context);
  const fromCursor = cursors.resolve(owner, resourceId, explicitCursor);
  const snapshot = broker.inspect(resourceId, owner, fromCursor);
  cursors.record(owner, snapshot);
  return { snapshot, fromCursor };
}

async function waitForResource(
  broker: AgentExecutionResourceBroker,
  cursors: AgentExecutionResourceCursorLedger,
  resourceId: string,
  explicitCursor: number | undefined,
  timeoutMs: number,
  context: AgentHostToolContext,
): Promise<ResourceObservation> {
  const owner = resourceOwner(context);
  const fromCursor = cursors.resolve(owner, resourceId, explicitCursor);
  const snapshot = await broker.wait(resourceId, owner, fromCursor, timeoutMs, context.signal);
  cursors.record(owner, snapshot);
  return { snapshot, fromCursor };
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
    mode: z.output<typeof SeneraShellCommandSpecSchema>["mode"];
    dialect: z.output<typeof SeneraShellCommandSpecSchema>["dialect"];
    script: z.output<typeof SeneraShellCommandSpecSchema>["script"];
    cwd?: string;
    workspaceEffect: z.output<typeof AgentWorkspaceEffectSchema>;
    title?: string;
    columns?: number;
    rows?: number;
  },
  context: AgentHostToolContext,
) {
  const cwdResult = await context.executionEnv.canonicalPath(args.cwd ?? ".");
  if (!cwdResult.ok) throw cwdResult.error;
  const profile = createAgentShellExecutionProfile(requireExecutionPlan(context));
  const shellCommand = {
    mode: args.mode,
    dialect: args.dialect,
    script: args.script,
  } satisfies z.output<typeof SeneraShellCommandSpecSchema>;
  const workspaceLease =
    args.workspaceEffect === AgentWorkspaceEffects.Mutate
      ? await context.workspaceObservation?.openResourceLease?.()
      : undefined;
  const request = {
    command: shellCommand.script,
    args: [],
    shellCommand,
    displayCommand: shellCommand.script,
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
  try {
    const snapshot = await broker.startTerminal({
      ...request,
      dimensions: { columns: args.columns, rows: args.rows },
    });
    workspaceLease?.bind(snapshot.resourceId);
    return snapshot;
  } catch (error) {
    workspaceLease?.cancel();
    throw error;
  }
}

function withValidatedArguments<TSchema extends z.ZodType<Record<string, unknown>>, TResult>(
  schema: TSchema,
  execute: (args: z.output<TSchema>, context: AgentHostToolContext) => TResult | Promise<TResult>,
  projectResult: (
    result: TResult,
    context: AgentHostToolContext,
  ) => AgentToolProcessRunResult | Promise<AgentToolProcessRunResult> = (result) => toolProcessSuccessResult(result),
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
      return await projectResult(await execute(parsed.data, context), context);
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

async function resourceSnapshotResult(
  broker: AgentExecutionResourceBroker,
  observation: ResourceObservation,
  context: AgentHostToolContext,
): Promise<AgentToolProcessRunResult> {
  const ownedLease = context.workspaceObservation?.hasResourceLease?.(observation.snapshot.resourceId) === true;
  const terminal = isTerminalResourceState(observation.snapshot.state);
  const workspaceCapture =
    terminal && ownedLease
      ? await context.workspaceObservation?.completeResourceLease?.(observation.snapshot.resourceId)
      : undefined;
  const result = toolProcessSuccessResult(
    projectAgentExecutionResourceResult(observation.snapshot, {
      fromCursor: observation.fromCursor,
      includeInvocation: observation.includeInvocation,
    }),
    {
      ...(workspaceCapture ? { workspaceCapture } : {}),
      ...(ownedLease
        ? {
            workspaceObservation: {
              resourceId: observation.snapshot.resourceId,
              state: terminal ? ("completed" as const) : ("active" as const),
            },
          }
        : {}),
    },
  );
  const outputCapture = broker.takeOutputCapture(observation.snapshot.resourceId, resourceOwner(context));
  return outputCapture ? { ...result, outputCapture } : result;
}

function isTerminalResourceState(state: AgentExecutionResourceSnapshot["state"]): boolean {
  return (
    state === AgentExecutionResourceStates.Completed ||
    state === AgentExecutionResourceStates.Failed ||
    state === AgentExecutionResourceStates.Cancelled
  );
}

function resourceOwner(context: AgentHostToolContext): AgentExecutionResourceOwner {
  return {
    workspaceRoot: context.workspaceRoot,
    sessionId: context.sessionId,
    requestId: context.requestId,
  };
}
