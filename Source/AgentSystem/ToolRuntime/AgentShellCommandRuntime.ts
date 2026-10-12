import { z } from "zod";
import type { AgentHostToolHandler } from "./AgentToolHostCapabilityRegistry.js";
import type { AgentToolProcessRunResult } from "./AgentToolProcessTypes.js";
import { createToolProcessSuccessResponse, toolProcessFailureResult } from "./AgentToolProcessEnvelope.js";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";
import { cancelledToolProcessResult } from "./AgentToolCancellation.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import {
  SeneraExecutionError,
  SeneraExecutionErrorCodes,
  type SeneraExecutionErrorCode,
} from "../Execution/SeneraExecutionTypes.js";
import type { SeneraProcessExecutionProfile } from "../Execution/SeneraExecutionProfile.js";
import type { AgentToolExecutionPlan } from "./AgentToolExecutionPlan.js";
import { SeneraShellCommandSpecSchema } from "../Execution/SeneraShellCommand.js";
import { AgentWorkspaceEffectSchema, AgentWorkspaceEffects } from "../Artifacts/AgentWorkspaceObservationIntent.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { resolveAgentToolCallTimeoutMs } from "./AgentToolDeadline.js";
import type { AgentExecutionResourceBroker } from "../ExecutionResources/AgentExecutionResourceBroker.js";
import {
  AgentExecutionResourceRetentionPolicies,
  AgentExecutionResourceStates,
  type AgentExecutionResourceOwner,
  type AgentExecutionResourceRetentionPolicy,
  type AgentExecutionResourceSnapshot,
} from "../ExecutionResources/AgentExecutionResourceTypes.js";
import { resolveAgentExecutionResourceInitialYieldMs } from "../ExecutionResources/AgentExecutionResourceConfig.js";
import { createAgentToolOutputSpool, type AgentToolOutputSpoolFactory } from "./AgentToolOutputSpool.js";
import type { SeneraOutputSpool, SeneraOutputSpoolDescriptor } from "../Execution/SeneraOutputSpool.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import {
  collectAgentExecutionResourceOutput,
  projectAgentExecutionResourceResult,
} from "./AgentExecutionResourceResultProjector.js";

const ShellExecutionProfileName = "host-shell";

const ShellCwdSchema = z.string().trim().min(1);
const ShellTimeoutSchema = z
  .number()
  .int()
  .nonnegative()
  .describe("0 表示不设运行时限，持续跟踪进程树直到退出或显式停止；正数受系统工具超时配置约束。")
  .optional();
export const ShellCommandArgumentsSchema = z
  .object({
    command: SeneraShellCommandSpecSchema,
    cwd: ShellCwdSchema.optional(),
    timeoutMs: ShellTimeoutSchema,
    workspaceEffect: AgentWorkspaceEffectSchema,
  })
  .strict();

export function createShellCommandHostTool(
  broker?: AgentExecutionResourceBroker,
  outputSpoolFactory: AgentToolOutputSpoolFactory = createAgentToolOutputSpool,
): AgentHostToolHandler {
  return async (args, context) => {
    const parsed = ShellCommandArgumentsSchema.safeParse(args);
    if (!parsed.success) {
      return shellFailure({
        code: AgentExecutionErrorCodes.InvalidToolArguments,
        message: agentErrorMessage("tool.shellArgumentsInvalid"),
        details: {
          phase: AgentToolProcessErrorPhases.RuntimeExecution,
          issues: parsed.error.issues,
          toolName: context.tool.name,
        },
        diagnostics: parsed.error.issues.map((issue) => ({
          message: issue.message,
          pointer: `/${issue.path.join("/")}`,
          path: issue.path.map((entry) => (typeof entry === "number" ? entry : String(entry))),
        })),
      });
    }

    const cwdResult = await context.executionEnv.canonicalPath(parsed.data.cwd ?? ".");
    if (!cwdResult.ok) {
      const message = cwdResult.error.message;
      return shellFailure({
        code: AgentExecutionErrorCodes.InvalidToolArguments,
        message,
        details: {
          phase: AgentToolProcessErrorPhases.RuntimeExecution,
          cwd: parsed.data.cwd,
          workspaceRoot: context.workspaceRoot,
        },
        diagnostics: [
          {
            message,
            pointer: "/cwd",
            path: ["cwd"],
            suggestion: agentErrorMessage("tool.shellCwdSuggestion"),
          },
        ],
      });
    }

    if (!broker) {
      return shellFailure({
        code: AgentExecutionErrorCodes.ToolProcessConfigurationInvalid,
        message: "Shell execution requires the execution resource broker.",
        details: { phase: AgentToolProcessErrorPhases.ConfigurationValidation, toolName: context.tool.name },
      });
    }

    const executionPolicy = resolveAgentShellCommandExecutionPolicy(context.config, parsed.data.timeoutMs);
    const executionProfile = createAgentShellExecutionProfile(requireExecutionPlan(context));
    const owner = shellResourceOwner(context);
    const workspaceLease =
      parsed.data.workspaceEffect === AgentWorkspaceEffects.Mutate
        ? await context.workspaceObservation?.openResourceLease?.()
        : undefined;
    let outputSpool: SeneraOutputSpool | undefined;
    let resourceStarted = false;
    try {
      outputSpool = await outputSpoolFactory(context.config, context.workspaceRoot, {
        sessionId: context.sessionId,
        requestId: context.requestId,
        toolCallId: context.toolCallId,
      });
      const started = await broker.startProcess({
        command: parsed.data.command.script,
        args: [],
        shellCommand: parsed.data.command,
        displayCommand: parsed.data.command.script,
        cwd: cwdResult.value,
        executionEnv: context.executionEnv,
        profile: executionProfile,
        owner,
        correlation: {
          sessionId: context.sessionId,
          requestId: context.requestId,
          step: context.step,
          toolCallId: context.toolCallId,
          toolName: context.tool.name,
          onEvent: context.onEvent,
        },
        signal: context.signal,
        maxDurationMs: executionPolicy.maxDurationMs,
        retention: executionPolicy.retention,
        outputSpool,
      });
      resourceStarted = true;
      workspaceLease?.bind(started.resourceId);
      const result = await waitForInitialShellOutcome(
        broker,
        started,
        owner,
        executionPolicy.initialYieldMs,
        context.signal,
      );
      const output = collectAgentExecutionResourceOutput(result);
      const outputCapture = takeTerminalOutputCapture(broker, result, owner);
      const terminal = isTerminalResourceState(result.state);
      const workspaceCapture = terminal ? await workspaceLease?.complete() : undefined;
      const workspaceObservation = {
        resourceId: started.resourceId,
        state: terminal ? ("completed" as const) : ("active" as const),
      };
      if (result.state === AgentExecutionResourceStates.Failed) {
        const failure = shellFailure({
          code: AgentExecutionErrorCodes.ToolExecutionError,
          message: result.error ?? "Shell execution resource failed.",
          details: {
            phase: AgentToolProcessErrorPhases.RuntimeExecution,
            resourceId: result.resourceId,
            state: result.state,
          },
        });
        return {
          ...failure,
          ...output,
          exitCode: result.exitCode ?? null,
          signal: normalizeResourceSignal(result.signal),
          ...(outputCapture ? { outputCapture } : {}),
          ...(workspaceCapture ? { workspaceCapture } : {}),
          workspaceObservation,
        };
      }
      return {
        response: createToolProcessSuccessResponse({
          command: parsed.data.command.script,
          shellDialect: parsed.data.command.dialect,
          cwd: cwdResult.value,
          ...projectAgentExecutionResourceResult(result, { fromCursor: started.cursor }),
        }),
        stdout: output.stdout,
        stderr: output.stderr,
        exitCode: result.exitCode ?? null,
        signal: normalizeResourceSignal(result.signal),
        ...(outputCapture ? { outputCapture } : {}),
        ...(workspaceCapture ? { workspaceCapture } : {}),
        workspaceObservation,
      };
    } catch (error) {
      if (outputSpool && !resourceStarted) await outputSpool.cleanup().catch(() => undefined);
      workspaceLease?.cancel();
      const failure = shellExecutionFailure({
        error,
        command: parsed.data.command.script,
        cwd: cwdResult.value,
        timeoutMs: executionPolicy.maxDurationMs,
        signal: context.signal,
      });
      return failure;
    }
  };
}

export interface AgentShellCommandExecutionPolicy {
  readonly maxDurationMs?: number;
  readonly retention: AgentExecutionResourceRetentionPolicy;
  readonly initialYieldMs: number;
}

export function resolveAgentShellCommandExecutionPolicy(
  config: AgentSystemConfig,
  requestedTimeoutMs?: number,
): AgentShellCommandExecutionPolicy {
  const initialYieldMs = resolveAgentExecutionResourceInitialYieldMs(config);
  if (requestedTimeoutMs === 0) {
    return {
      retention: AgentExecutionResourceRetentionPolicies.UntilExit,
      initialYieldMs,
    };
  }

  const maxDurationMs = resolveAgentToolCallTimeoutMs(config, requestedTimeoutMs);
  return {
    maxDurationMs,
    retention: AgentExecutionResourceRetentionPolicies.Idle,
    initialYieldMs: Math.min(initialYieldMs, maxDurationMs),
  };
}

function takeTerminalOutputCapture(
  broker: AgentExecutionResourceBroker,
  snapshot: AgentExecutionResourceSnapshot,
  owner: AgentExecutionResourceOwner,
): SeneraOutputSpoolDescriptor | undefined {
  return isTerminalResourceState(snapshot.state) ? broker.takeOutputCapture(snapshot.resourceId, owner) : undefined;
}

async function waitForInitialShellOutcome(
  broker: AgentExecutionResourceBroker,
  started: AgentExecutionResourceSnapshot,
  owner: AgentExecutionResourceOwner,
  initialYieldMs: number,
  signal?: AbortSignal,
): Promise<AgentExecutionResourceSnapshot> {
  const deadline = Date.now() + initialYieldMs;
  let snapshot = started;
  while (!isTerminalResourceState(snapshot.state)) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    snapshot = await broker.wait(snapshot.resourceId, owner, snapshot.cursor, remainingMs, signal);
  }
  return broker.inspect(started.resourceId, owner, started.cursor);
}

function isTerminalResourceState(state: AgentExecutionResourceSnapshot["state"]): boolean {
  return (
    state === AgentExecutionResourceStates.Completed ||
    state === AgentExecutionResourceStates.Failed ||
    state === AgentExecutionResourceStates.Cancelled
  );
}

function normalizeResourceSignal(signal: AgentExecutionResourceSnapshot["signal"]): NodeJS.Signals | null {
  return typeof signal === "string" && signal.startsWith("SIG") ? (signal as NodeJS.Signals) : null;
}

function shellResourceOwner(context: Parameters<AgentHostToolHandler>[1]): AgentExecutionResourceOwner {
  return {
    workspaceRoot: context.workspaceRoot,
    sessionId: context.sessionId,
    requestId: context.requestId,
  };
}

export function createAgentShellExecutionProfile(executionPlan: AgentToolExecutionPlan): SeneraProcessExecutionProfile {
  const local = executionPlan.backend === "local";
  return {
    name: ShellExecutionProfileName,
    kind: "shell",
    backend: executionPlan.backend,
    sandbox: local
      ? undefined
      : {
          network: executionPlan.network,
          workspaceMount: executionPlan.workspaceMount,
        },
  };
}

function requireExecutionPlan(context: Parameters<AgentHostToolHandler>[1]): AgentToolExecutionPlan {
  if (!context.executionPlan) {
    throw new Error(`Tool ${context.tool.name} is missing its resolved execution plan.`);
  }
  return context.executionPlan;
}

function shellFailure(error: NonNullable<AgentToolProcessRunResult["response"]["error"]>): AgentToolProcessRunResult {
  return toolProcessFailureResult(error);
}

function shellExecutionFailure(input: {
  error: unknown;
  command: string;
  cwd: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): AgentToolProcessRunResult {
  const message = errorMessage(input.error);
  const code = shellErrorCode(input.error);
  if (input.signal?.aborted || code === AgentExecutionErrorCodes.ToolProcessCancelled) {
    return cancelledToolProcessResult({
      signal: input.signal,
      phase: "runtime",
      command: input.command,
      cwd: input.cwd,
    });
  }

  return shellFailure({
    code,
    message:
      code === AgentExecutionErrorCodes.ToolProcessTimeout && input.timeoutMs !== undefined
        ? agentErrorMessage("tool.shellCommandTimeout", {
            timeoutMs: input.timeoutMs,
            command: input.command,
          })
        : message,
    details: {
      phase:
        code === AgentExecutionErrorCodes.ToolProcessSpawnFailed
          ? AgentToolProcessErrorPhases.ProcessSpawn
          : AgentToolProcessErrorPhases.RuntimeExecution,
      cwd: input.cwd,
      command: input.command,
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      seneraExecutionCode: input.error instanceof SeneraExecutionError ? input.error.code : undefined,
      ...(input.error instanceof SeneraExecutionError && input.error.diagnostic
        ? { seneraExecutionDiagnostic: input.error.diagnostic }
        : {}),
    },
  });
}

const AgentShellErrorCodeBySeneraCode = {
  [SeneraExecutionErrorCodes.Aborted]: AgentExecutionErrorCodes.ToolProcessCancelled,
  [SeneraExecutionErrorCodes.InvalidWorkspacePath]: AgentExecutionErrorCodes.InvalidToolArguments,
  [SeneraExecutionErrorCodes.Timeout]: AgentExecutionErrorCodes.ToolProcessTimeout,
  [SeneraExecutionErrorCodes.StdoutLimitExceeded]: AgentExecutionErrorCodes.ToolProcessStdoutLimitExceeded,
  [SeneraExecutionErrorCodes.StderrLimitExceeded]: AgentExecutionErrorCodes.ToolProcessStderrLimitExceeded,
  [SeneraExecutionErrorCodes.SandboxUnavailable]: AgentExecutionErrorCodes.ToolProcessSpawnFailed,
  [SeneraExecutionErrorCodes.SpawnFailed]: AgentExecutionErrorCodes.ToolProcessSpawnFailed,
  [SeneraExecutionErrorCodes.CleanupFailed]: AgentExecutionErrorCodes.ToolExecutionError,
  [SeneraExecutionErrorCodes.Unknown]: AgentExecutionErrorCodes.ToolProcessSpawnFailed,
} satisfies Record<SeneraExecutionErrorCode, (typeof AgentExecutionErrorCodes)[keyof typeof AgentExecutionErrorCodes]>;

function shellErrorCode(error: unknown): (typeof AgentExecutionErrorCodes)[keyof typeof AgentExecutionErrorCodes] {
  return error instanceof SeneraExecutionError
    ? AgentShellErrorCodeBySeneraCode[error.code]
    : AgentExecutionErrorCodes.ToolProcessSpawnFailed;
}
