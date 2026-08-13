import { createRequestId } from "../Core/AgentIds.js";
import type { AgentToolExecutionArtifactRecorder } from "../Artifacts/AgentToolExecutionArtifactRecorder.js";
import type { AskUserControlResult, SuspendChildRunControlResult } from "../ToolRuntime/AgentToolCallExecutionTypes.js";
import type { AgentToolCallExecutor } from "../ToolRuntime/AgentToolCallExecutor.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import { AgentToolObservationContextCompiler } from "../ToolRuntime/AgentToolObservationContextCompiler.js";
import { StandardAgentToolObservationProjection } from "../ToolRuntime/AgentToolObservationProjectionPlan.js";
import { redactArtifactSecrets, redactArtifactToolOutcome } from "../Artifacts/AgentArtifactRedaction.js";
import { AgentPiToolResultStatuses, type AgentPiToolExecutionInput, type AgentPiToolResult } from "./AgentPiTypes.js";
import type { AgentToolExecutionScheduler } from "../ToolRuntime/AgentToolExecutionScheduler.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import {
  AgentToolAssessmentStatuses,
  AgentToolExecutionStatuses,
  AgentToolOutputAvailabilities,
  readAgentToolFailure,
  type AgentToolExecutionOutcome,
} from "../ToolRuntime/AgentToolResultOutcome.js";
import type { AgentToolObservationProjectionManifest } from "../Types/AgentToolObservationProjectionTypes.js";
import type { AgentToolTokenReservation } from "../Text/AgentTurnTokenBudget.js";
import { resolveAgentToolRuntimeCapabilities } from "../ToolRuntime/AgentToolRuntimeCapabilities.js";

export interface AgentPiToolExecutionBridgeOptions {
  model: string;
  executeToolCall: AgentToolCallExecutor["execute"];
  recordToolArtifacts: AgentToolExecutionArtifactRecorder["record"];
  executionScheduler?: Pick<AgentToolExecutionScheduler, "run">;
}

export class AgentPiToolExecutionBridge {
  private readonly observationCompiler: AgentToolObservationContextCompiler;

  constructor(private readonly options: AgentPiToolExecutionBridgeOptions) {
    this.observationCompiler = new AgentToolObservationContextCompiler({ model: options.model });
  }

  async execute(input: AgentPiToolExecutionInput): Promise<AgentPiToolResult> {
    const operation = () => this.executeWithLease(input);
    const turnState = input.context.turnState;
    if (!turnState) throw new Error("Pi tool execution requires an active turn state.");
    return this.options.executionScheduler &&
      resolveAgentToolRuntimeCapabilities(input.tool).scheduling !== "self-managed"
      ? this.options.executionScheduler.run(turnState, input.tool, input.params, operation, input.signal)
      : operation();
  }

  private async executeWithLease(input: AgentPiToolExecutionInput): Promise<AgentPiToolResult> {
    const toolAccessGrant = input.context.toolAccessGrant;
    if (!toolAccessGrant) throw new AgentLocalizedError("toolAccess.missingGrant");
    const turnState = input.context.turnState;
    if (!turnState) throw new Error("Pi tool execution requires an active turn state.");
    const sessionId =
      input.context.sessionId ??
      turnState.context.sessionId ??
      input.context.requestId ??
      turnState.context.requestId ??
      input.toolCallId;
    const artifactSessionId = input.context.sessionId ?? turnState.context.sessionId;
    const requestId = input.context.requestId ?? turnState.context.requestId ?? createRequestId();
    const step = input.context.step ?? turnState.context.step ?? 1;
    const batchId = turnState.toolBatchId(input.toolCallId);
    if (!batchId) throw new Error(`Pi tool call ${input.toolCallId} is not registered in a tool batch.`);
    const projection = input.tool.observationProjection ?? StandardAgentToolObservationProjection;
    const reservation = turnState.claimToolObservationBudget(input.toolCallId, projection.maxTokens);
    try {
      const execution = await this.options.executeToolCall(
        {
          name: input.tool.name,
          arguments: input.params,
          expectedContractDigest: input.tool.contract?.digest ?? null,
          callId: input.toolCallId,
          index: turnState.toolBatchIndex(input.toolCallId),
        },
        {
          sessionId,
          requestId,
          step,
          onEvent: input.context.onEvent,
          toolAccessGrant,
          resourceAccessGrant: turnState.takeResourceAccessGrant(input.toolCallId),
          toolExposure: input.context.toolExposure,
          batchId,
          signal: input.signal,
          tokenBudget: reservation,
          approvalMode: input.context.approvalMode,
          activeSkills: input.context.activeSkills,
          thinkingLevel: input.context.thinkingLevel,
          onLifecycleSettled: (status) => turnState.recordExecutorLifecycleStatus(input.toolCallId, status),
          deferResultDetail: true,
        },
      );

      if (execution.kind === "AskUser") {
        return this.projectAskUser(input, batchId, execution.value, projection, reservation);
      }
      if (execution.kind === "SuspendChildRun") {
        return this.projectChildRunSuspension(input, batchId, execution.value, projection, reservation);
      }

      const [recorded] = await this.options.recordToolArtifacts({
        ...(artifactSessionId ? { sessionId: artifactSessionId } : {}),
        requestId,
        step,
        results: execution.value,
      });
      const result = recorded ?? execution.value[0];
      if (!result) throw new Error("Tool execution completed without a result.");
      assertExecutedToolIdentity(input, result);
      turnState.registerExecutedToolResult(input.toolCallId, result);
      return this.projectToolResult(input, result, batchId, projection, reservation);
    } catch (error) {
      reservation.release();
      throw error;
    }
  }

  private projectAskUser(
    input: AgentPiToolExecutionInput,
    batchId: string,
    result: AskUserControlResult,
    projection: AgentToolObservationProjectionManifest,
    reservation: AgentToolTokenReservation,
  ): AgentPiToolResult {
    const observation = this.observationCompiler.compile(
      {
        toolName: input.tool.name,
        callId: input.toolCallId,
        batchId,
        status: "waiting",
        executionStatus: AgentToolExecutionStatuses.Completed,
        outputAvailability: AgentToolOutputAvailabilities.Complete,
        summary: result.question,
        outcome: undefined,
        process: undefined,
        error: undefined,
        result,
        arguments: undefined,
        artifact: undefined,
      },
      projection,
      reservation.limit,
    );
    const content = JSON.stringify(observation);
    reservation.commit(content);
    return {
      content: [
        {
          type: "text",
          text: content,
        },
      ],
      details: {
        senera: {
          toolName: input.tool.name,
          status: AgentPiToolResultStatuses.Success,
          executionStatus: AgentToolExecutionStatuses.Completed,
          outputAvailability: AgentToolOutputAvailabilities.Complete,
        },
      },
      terminate: true,
    };
  }

  private projectChildRunSuspension(
    input: AgentPiToolExecutionInput,
    batchId: string,
    result: SuspendChildRunControlResult,
    projection: AgentToolObservationProjectionManifest,
    reservation: AgentToolTokenReservation,
  ): AgentPiToolResult {
    const observation = this.observationCompiler.compile(
      {
        toolName: input.tool.name,
        callId: input.toolCallId,
        batchId,
        status: "waiting",
        executionStatus: AgentToolExecutionStatuses.Completed,
        outputAvailability: AgentToolOutputAvailabilities.Complete,
        summary: "The child run is waiting for a supervisor response.",
        outcome: undefined,
        process: undefined,
        error: undefined,
        result,
        arguments: undefined,
        artifact: undefined,
      },
      projection,
      reservation.limit,
    );
    const content = JSON.stringify(observation);
    reservation.commit(content);
    return {
      content: [{ type: "text", text: content }],
      details: {
        senera: {
          toolName: input.tool.name,
          status: AgentPiToolResultStatuses.Success,
          executionStatus: AgentToolExecutionStatuses.Completed,
          outputAvailability: AgentToolOutputAvailabilities.Complete,
        },
      },
      terminate: true,
    };
  }

  private projectToolResult(
    input: AgentPiToolExecutionInput,
    result: ExecutedToolCallResult,
    batchId: string,
    projection: AgentToolObservationProjectionManifest,
    reservation: AgentToolTokenReservation,
  ): AgentPiToolResult {
    const tool = input.tool;
    const outcome = redactArtifactToolOutcome(result.outcome, result.artifactPolicy);
    const observation = this.observationCompiler.compile(
      projectToolObservation(result, outcome, batchId),
      projection,
      reservation.limit,
    );
    const content = JSON.stringify(observation);
    reservation.commit(content);

    return {
      content: [
        {
          type: "text",
          text: content,
        },
      ],
      details: projectToolDetails(tool.name, result, outcome),
    };
  }
}

function assertExecutedToolIdentity(input: AgentPiToolExecutionInput, result: ExecutedToolCallResult): void {
  if (result.callId !== input.toolCallId || result.name !== input.tool.name) {
    throw new Error(`Executed tool result identity does not match Pi call ${input.toolCallId}.`);
  }
}

function projectToolObservation(
  result: ExecutedToolCallResult,
  outcome: AgentToolExecutionOutcome,
  batchId: string,
): import("../ToolRuntime/AgentToolObservationContextCompiler.js").AgentToolObservationContextCompilerInput {
  const error = readAgentToolFailure(outcome);
  return {
    callId: result.callId,
    batchId,
    toolName: result.name,
    arguments: redactArtifactSecrets(result.arguments, result.artifactPolicy),
    process: redactArtifactSecrets(result.process, result.artifactPolicy),
    outcome,
    status: outcome.assessment.status,
    executionStatus: outcome.execution.status,
    outputAvailability: outcome.output.availability,
    result: redactArtifactSecrets(result.result, result.artifactPolicy),
    error,
    artifact: result.artifact,
    semanticProjection: result.semanticProjection,
  };
}

function projectToolDetails(
  toolName: string,
  result: ExecutedToolCallResult,
  outcome: AgentToolExecutionOutcome,
): AgentPiToolResult["details"] {
  const context = {
    toolName,
    artifactUri: result.artifact?.artifactUri,
    callId: result.callId,
    executionStatus: outcome.execution.status,
    outputAvailability: outcome.output.availability,
  };
  return {
    senera:
      outcome.assessment.status === AgentToolAssessmentStatuses.Failure
        ? {
            ...context,
            status: AgentPiToolResultStatuses.Failure,
            error: outcome.assessment.error,
          }
        : { ...context, status: outcome.assessment.status },
  };
}
