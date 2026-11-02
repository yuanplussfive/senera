import { isTerminalResourceState } from "../ExecutionResources/AgentExecutionResourceTypes.js";
import type { AgentExecutionResourceBroker } from "../ExecutionResources/AgentExecutionResourceBroker.js";
import { AgentExecutionResourceError } from "../ExecutionResources/AgentExecutionResourceError.js";
import { type AgentExecutionResourceSignal } from "../ExecutionResources/AgentExecutionResourceTypes.js";
import type { SeneraShellCommandSpec } from "../Execution/SeneraShellCommand.js";
import { AgentWorkspaceEffects, type AgentWorkspaceEffect } from "../Artifacts/AgentWorkspaceObservationIntent.js";
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
import { systemToolArguments } from "../SystemTools/AgentSystemToolDefinition.js";

/** All shapes below have already passed their respective package JSON Schema. */
interface TerminalStartArguments extends SeneraShellCommandSpec {
  readonly cwd?: string;
  readonly workspaceEffect: AgentWorkspaceEffect;
  readonly title?: string;
  readonly columns?: number;
  readonly rows?: number;
}

interface ResourceInspectArguments {
  readonly resourceId: string;
  readonly cursor?: number;
}

interface ResourceWaitArguments extends ResourceInspectArguments {
  readonly timeoutMs?: number;
}

interface ResourceWriteArguments {
  readonly resourceId: string;
  readonly input: string;
  readonly appendNewline?: boolean;
}

interface ResourceSignalArguments {
  readonly resourceId: string;
  readonly signal: AgentExecutionResourceSignal;
}

interface ResourceResizeArguments {
  readonly resourceId: string;
  readonly columns: number;
  readonly rows: number;
}

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
    startTerminal: withResourceOperation<TerminalStartArguments, ResourceObservation>(
      async (args, context) => {
        const snapshot = await startTerminalResource(broker, args, context);
        cursors.record(resourceOwner(context), snapshot);
        return { snapshot, fromCursor: snapshot.cursor, includeInvocation: true } satisfies ResourceObservation;
      },
      (value, context) => resourceSnapshotResult(broker, value, context),
    ),
    inspect: withResourceOperation<ResourceInspectArguments, ResourceObservation>(
      (args, context) => inspectResource(broker, cursors, args.resourceId, args.cursor, context),
      (value, context) => resourceSnapshotResult(broker, value, context),
    ),
    wait: withResourceOperation<ResourceWaitArguments, ResourceObservation>(
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
    write: withResourceOperation<ResourceWriteArguments, ResourceObservation>(
      async (args, context) => {
        const input = args.appendNewline ? `${args.input}${process.platform === "win32" ? "\r\n" : "\n"}` : args.input;
        const snapshot = await broker.write(args.resourceId, resourceOwner(context), Buffer.from(input, "utf8"));
        cursors.record(resourceOwner(context), snapshot);
        return { snapshot, fromCursor: snapshot.cursor } satisfies ResourceObservation;
      },
      (value, context) => resourceSnapshotResult(broker, value, context),
    ),
    signal: withResourceOperation<ResourceSignalArguments, ResourceObservation>(
      async (args, context) => {
        const snapshot = await broker.signal(args.resourceId, resourceOwner(context), args.signal);
        cursors.record(resourceOwner(context), snapshot);
        return { snapshot, fromCursor: snapshot.cursor } satisfies ResourceObservation;
      },
      (value, context) => resourceSnapshotResult(broker, value, context),
    ),
    list: withResourceOperation<Record<string, never>, ReturnType<typeof projectAgentExecutionResourceCollection>>(
      (_args, context) => ({
        resources: projectAgentExecutionResourceCollection(broker.list(resourceOwner(context))).resources,
      }),
    ),
    resize: withResourceOperation<ResourceResizeArguments, ResourceObservation>(
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
    stopAll: withResourceOperation<Record<string, never>, ReturnType<typeof projectAgentExecutionResourceCollection>>(
      async (_args, context) => {
        const snapshots = await broker.stopAll(resourceOwner(context));
        snapshots.forEach((snapshot) => cursors.record(resourceOwner(context), snapshot));
        return projectAgentExecutionResourceCollection(snapshots);
      },
    ),
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
  args: TerminalStartArguments,
  context: AgentHostToolContext,
) {
  const cwdResult = await context.executionEnv.canonicalPath(args.cwd ?? ".");
  if (!cwdResult.ok) throw cwdResult.error;
  const profile = createAgentShellExecutionProfile(requireExecutionPlan(context));
  const shellCommand = {
    mode: args.mode,
    dialect: args.dialect,
    script: args.script,
  } satisfies SeneraShellCommandSpec;
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

function withResourceOperation<TArguments extends object, TResult>(
  execute: (args: TArguments, context: AgentHostToolContext) => TResult | Promise<TResult>,
  projectResult: (
    result: TResult,
    context: AgentHostToolContext,
  ) => AgentToolProcessRunResult | Promise<AgentToolProcessRunResult> = (result) => toolProcessSuccessResult(result),
): AgentHostToolHandler {
  return async (args, context) => {
    try {
      return await projectResult(await execute(systemToolArguments<TArguments>(args), context), context);
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

function resourceOwner(context: AgentHostToolContext): AgentExecutionResourceOwner {
  return {
    workspaceRoot: context.workspaceRoot,
    sessionId: context.sessionId,
    requestId: context.requestId,
  };
}
