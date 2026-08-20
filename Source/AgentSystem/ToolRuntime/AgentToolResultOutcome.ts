import { z } from "zod";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import type { AgentToolProcessError, ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import { ToolResultAssessmentPolicies, type ToolResultAssessmentPolicy } from "../Types/AgentToolContractTypes.js";
import {
  AgentExecutionErrorCodes,
  AgentToolProcessErrorPhases,
  type AgentExecutionErrorCode,
} from "../Xml/AgentXmlStatus.js";
import { AgentToolProcessErrorSchema, createToolProcessFailureResponse } from "./AgentToolProcessEnvelope.js";
import type { AgentToolProcessRunResult } from "./AgentToolProcessTypes.js";

export const AgentToolExecutionStatuses = {
  Completed: "completed",
  TimedOut: "timed_out",
  Cancelled: "cancelled",
  NotStarted: "not_started",
} as const;

export type AgentToolExecutionStatus = (typeof AgentToolExecutionStatuses)[keyof typeof AgentToolExecutionStatuses];

export const AgentToolAssessmentStatuses = {
  Success: "success",
  Failure: "failure",
  Unassessed: "unassessed",
} as const;

export type AgentToolAssessmentStatus = (typeof AgentToolAssessmentStatuses)[keyof typeof AgentToolAssessmentStatuses];
type AgentToolNonFailureAssessmentStatus = Exclude<
  AgentToolAssessmentStatus,
  typeof AgentToolAssessmentStatuses.Failure
>;

const AgentToolAssessmentStatusSchema = z.enum(AgentToolAssessmentStatuses);

export const AgentToolOutputAvailabilities = {
  Complete: "complete",
  Partial: "partial",
  None: "none",
} as const;

export type AgentToolOutputAvailability =
  (typeof AgentToolOutputAvailabilities)[keyof typeof AgentToolOutputAvailabilities];

const AgentToolOutputAvailabilitySchema = z.enum(AgentToolOutputAvailabilities);

export const AgentToolFailureKinds = {
  InvalidRequest: "invalid_request",
  Execution: "execution",
  Configuration: "configuration",
  UnsupportedRuntime: "unsupported_runtime",
  ProcessSpawn: "process_spawn",
  ProcessExit: "process_exit",
  ProcessSignal: "process_signal",
  Timeout: "timeout",
  Cancelled: "cancelled",
  OutputLimit: "output_limit",
  InvalidResponse: "invalid_response",
} as const;

export type AgentToolFailureKind = (typeof AgentToolFailureKinds)[keyof typeof AgentToolFailureKinds];

export const AgentToolFailureSources = {
  Host: "host",
  Mcp: "mcp",
  Process: "process",
} as const;

export type AgentToolFailureSource = (typeof AgentToolFailureSources)[keyof typeof AgentToolFailureSources];

export interface AgentToolFailure extends AgentToolProcessError {
  readonly kind: AgentToolFailureKind;
  readonly source: AgentToolFailureSource;
  readonly retryable: boolean;
}

export type AgentToolAssessment =
  | { readonly status: typeof AgentToolAssessmentStatuses.Success }
  | { readonly status: typeof AgentToolAssessmentStatuses.Unassessed }
  | {
      readonly status: typeof AgentToolAssessmentStatuses.Failure;
      readonly error: AgentToolFailure;
    };

export interface AgentToolExecutionOutcome {
  readonly execution: { readonly status: AgentToolExecutionStatus };
  readonly assessment: AgentToolAssessment;
  readonly output: { readonly availability: AgentToolOutputAvailability };
}

export const AgentToolFailureSchema = AgentToolProcessErrorSchema.extend({
  kind: z.enum(AgentToolFailureKinds),
  source: z.enum(AgentToolFailureSources),
  retryable: z.boolean(),
}).strip();

const AgentToolAssessmentSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal(AgentToolAssessmentStatuses.Success) }).strict(),
  z.object({ status: z.literal(AgentToolAssessmentStatuses.Unassessed) }).strict(),
  z
    .object({
      status: z.literal(AgentToolAssessmentStatuses.Failure),
      error: AgentToolFailureSchema,
    })
    .strict(),
]);

export const AgentToolExecutionOutcomeSchema = z
  .object({
    execution: z.object({ status: z.enum(AgentToolExecutionStatuses) }).strict(),
    assessment: AgentToolAssessmentSchema,
    output: z.object({ availability: AgentToolOutputAvailabilitySchema }).strict(),
  })
  .strict();

export const AgentToolSuccessOutcome: AgentToolExecutionOutcome = Object.freeze({
  execution: Object.freeze({ status: AgentToolExecutionStatuses.Completed }),
  assessment: Object.freeze({ status: AgentToolAssessmentStatuses.Success }),
  output: Object.freeze({ availability: AgentToolOutputAvailabilities.Complete }),
});

export function isAgentToolExecutionOutcome(value: unknown): value is AgentToolExecutionOutcome {
  return AgentToolExecutionOutcomeSchema.safeParse(value).success;
}

interface AgentToolFailurePolicy {
  readonly kind: AgentToolFailureKind;
  readonly retryable: boolean;
  readonly source?: AgentToolFailureSource;
}

const AgentToolFailurePolicies: Record<AgentExecutionErrorCode, AgentToolFailurePolicy> = {
  [AgentExecutionErrorCodes.UnknownToolName]: { kind: AgentToolFailureKinds.InvalidRequest, retryable: false },
  [AgentExecutionErrorCodes.InvalidToolArguments]: { kind: AgentToolFailureKinds.InvalidRequest, retryable: false },
  [AgentExecutionErrorCodes.ToolResultSchemaInvalid]: {
    kind: AgentToolFailureKinds.InvalidResponse,
    retryable: false,
  },
  [AgentExecutionErrorCodes.ToolExecutionError]: { kind: AgentToolFailureKinds.Execution, retryable: false },
  [AgentExecutionErrorCodes.ToolProcessConfigurationInvalid]: {
    kind: AgentToolFailureKinds.Configuration,
    retryable: false,
  },
  [AgentExecutionErrorCodes.ToolProcessRuntimeUnsupported]: {
    kind: AgentToolFailureKinds.UnsupportedRuntime,
    retryable: false,
  },
  [AgentExecutionErrorCodes.ToolProcessSpawnFailed]: {
    kind: AgentToolFailureKinds.ProcessSpawn,
    retryable: false,
    source: AgentToolFailureSources.Process,
  },
  [AgentExecutionErrorCodes.ToolProcessExited]: {
    kind: AgentToolFailureKinds.ProcessExit,
    retryable: false,
    source: AgentToolFailureSources.Process,
  },
  [AgentExecutionErrorCodes.ToolProcessSignalled]: {
    kind: AgentToolFailureKinds.ProcessSignal,
    retryable: false,
    source: AgentToolFailureSources.Process,
  },
  [AgentExecutionErrorCodes.ToolProcessTimeout]: { kind: AgentToolFailureKinds.Timeout, retryable: true },
  [AgentExecutionErrorCodes.ToolProcessCancelled]: { kind: AgentToolFailureKinds.Cancelled, retryable: false },
  [AgentExecutionErrorCodes.ToolProcessStdoutLimitExceeded]: {
    kind: AgentToolFailureKinds.OutputLimit,
    retryable: false,
    source: AgentToolFailureSources.Process,
  },
  [AgentExecutionErrorCodes.ToolProcessStderrLimitExceeded]: {
    kind: AgentToolFailureKinds.OutputLimit,
    retryable: false,
    source: AgentToolFailureSources.Process,
  },
  [AgentExecutionErrorCodes.ToolProcessResponseMissing]: {
    kind: AgentToolFailureKinds.InvalidResponse,
    retryable: false,
    source: AgentToolFailureSources.Process,
  },
  [AgentExecutionErrorCodes.ToolProcessResponseInvalid]: {
    kind: AgentToolFailureKinds.InvalidResponse,
    retryable: false,
    source: AgentToolFailureSources.Process,
  },
  [AgentExecutionErrorCodes.ToolProcessResponseEnvelopeInvalid]: {
    kind: AgentToolFailureKinds.InvalidResponse,
    retryable: false,
    source: AgentToolFailureSources.Process,
  },
};

const ExecutionStatusByFailureKind: Record<AgentToolFailureKind, AgentToolExecutionStatus> = {
  [AgentToolFailureKinds.InvalidRequest]: AgentToolExecutionStatuses.NotStarted,
  [AgentToolFailureKinds.Configuration]: AgentToolExecutionStatuses.NotStarted,
  [AgentToolFailureKinds.UnsupportedRuntime]: AgentToolExecutionStatuses.NotStarted,
  [AgentToolFailureKinds.ProcessSpawn]: AgentToolExecutionStatuses.NotStarted,
  [AgentToolFailureKinds.Timeout]: AgentToolExecutionStatuses.TimedOut,
  [AgentToolFailureKinds.Cancelled]: AgentToolExecutionStatuses.Cancelled,
  [AgentToolFailureKinds.Execution]: AgentToolExecutionStatuses.Completed,
  [AgentToolFailureKinds.ProcessExit]: AgentToolExecutionStatuses.Completed,
  [AgentToolFailureKinds.ProcessSignal]: AgentToolExecutionStatuses.Completed,
  [AgentToolFailureKinds.OutputLimit]: AgentToolExecutionStatuses.Completed,
  [AgentToolFailureKinds.InvalidResponse]: AgentToolExecutionStatuses.Completed,
};

const ProcessResultNormalizers: Record<
  ToolResultAssessmentPolicy,
  (result: AgentToolProcessRunResult) => AgentToolProcessRunResult
> = {
  [ToolResultAssessmentPolicies.ProcessExit]: normalizeProcessExit,
  [ToolResultAssessmentPolicies.Unassessed]: (result) => result,
};

const SuccessfulAssessmentStatusByPolicy: Record<ToolResultAssessmentPolicy, AgentToolNonFailureAssessmentStatus> = {
  [ToolResultAssessmentPolicies.ProcessExit]: AgentToolAssessmentStatuses.Success,
  [ToolResultAssessmentPolicies.Unassessed]: AgentToolAssessmentStatuses.Unassessed,
};

export function createAgentToolExecutionOutcome(
  result: AgentToolProcessRunResult,
  source: AgentToolFailureSource,
  assessmentPolicy: ToolResultAssessmentPolicy,
): AgentToolExecutionOutcome {
  const failure = result.response.ok ? undefined : createAgentToolFailure(result.response.error, source);
  return {
    execution: {
      status: failure ? ExecutionStatusByFailureKind[failure.kind] : AgentToolExecutionStatuses.Completed,
    },
    assessment: failure
      ? { status: AgentToolAssessmentStatuses.Failure, error: failure }
      : { status: SuccessfulAssessmentStatusByPolicy[assessmentPolicy] },
    output: { availability: projectOutputAvailability(result) },
  };
}

export function createAgentToolFailureOutcome(
  error: AgentToolProcessError,
  source: AgentToolFailureSource,
  outputAvailability: AgentToolOutputAvailability,
): AgentToolExecutionOutcome {
  const failure = createAgentToolFailure(error, source);
  return {
    execution: { status: ExecutionStatusByFailureKind[failure.kind] },
    assessment: { status: AgentToolAssessmentStatuses.Failure, error: failure },
    output: { availability: outputAvailability },
  };
}

export function normalizeAgentToolProcessResult(
  result: AgentToolProcessRunResult,
  assessmentPolicy: ToolResultAssessmentPolicy,
): AgentToolProcessRunResult {
  return ProcessResultNormalizers[assessmentPolicy](result);
}

export function readAgentToolFailure(outcome: AgentToolExecutionOutcome): AgentToolFailure | undefined {
  return outcome.assessment.status === AgentToolAssessmentStatuses.Failure ? outcome.assessment.error : undefined;
}

export function projectAgentExecutedToolResultStatus(
  result: Pick<ExecutedToolCallResult, "outcome">,
): AgentToolAssessmentStatus {
  return result.outcome.assessment.status;
}

export function readAgentToolOutputAvailability(value: unknown): AgentToolOutputAvailability {
  return AgentToolOutputAvailabilitySchema.safeParse(value).data ?? AgentToolOutputAvailabilities.None;
}

export function readAgentToolAssessmentStatus(value: unknown): AgentToolAssessmentStatus | undefined {
  return AgentToolAssessmentStatusSchema.safeParse(value).data;
}

function createAgentToolFailure(error: AgentToolProcessError, source: AgentToolFailureSource): AgentToolFailure {
  const policy = AgentToolFailurePolicies[error.code];
  return {
    ...error,
    kind: policy.kind,
    source: policy.source ?? source,
    retryable: policy.retryable,
  };
}

function projectOutputAvailability(result: AgentToolProcessRunResult): AgentToolOutputAvailability {
  if (result.response.ok) return AgentToolOutputAvailabilities.Complete;
  return result.stdout.length > 0 || result.stderr.length > 0 || result.outputCapture
    ? AgentToolOutputAvailabilities.Partial
    : AgentToolOutputAvailabilities.None;
}

function normalizeProcessExit(result: AgentToolProcessRunResult): AgentToolProcessRunResult {
  if (!result.response.ok) return result;
  if (result.exitCode !== null && result.exitCode !== 0) {
    return withProcessFailure(result, {
      code: AgentExecutionErrorCodes.ToolProcessExited,
      message: agentErrorMessage("tool.processFailed", { reason: `exit code ${result.exitCode}` }),
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        exitCode: result.exitCode,
        signal: result.signal,
      },
    });
  }
  return result.signal
    ? withProcessFailure(result, {
        code: AgentExecutionErrorCodes.ToolProcessSignalled,
        message: agentErrorMessage("tool.processFailed", { reason: `signal ${result.signal}` }),
        details: {
          phase: AgentToolProcessErrorPhases.RuntimeExecution,
          exitCode: result.exitCode,
          signal: result.signal,
        },
      })
    : result;
}

function withProcessFailure(
  result: AgentToolProcessRunResult,
  error: AgentToolProcessError,
): AgentToolProcessRunResult {
  return { ...result, response: createToolProcessFailureResponse(error) };
}
