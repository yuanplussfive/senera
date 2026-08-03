import { createRequestId } from "../Core/AgentIds.js";
import type { AgentToolExecutionArtifactRecorder } from "../Artifacts/AgentToolExecutionArtifactRecorder.js";
import type { AskUserControlResult } from "../ToolRuntime/AgentToolCallExecutionTypes.js";
import type { AgentToolCallExecutor } from "../ToolRuntime/AgentToolCallExecutor.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import { AgentToolObservationContextCompiler } from "../ToolRuntime/AgentToolObservationContextCompiler.js";
import { StandardAgentToolObservationProjection } from "../ToolRuntime/AgentToolObservationProjectionPlan.js";
import { redactArtifactSecrets, redactArtifactToolOutcome } from "../Artifacts/AgentArtifactRedaction.js";
import type { AgentPiTurnContextStore } from "../PiShared/AgentPiTurnContext.js";
import { AgentPiToolResultStatuses, type AgentPiToolExecutionInput, type AgentPiToolResult } from "./AgentPiTypes.js";
import type { AgentToolResourceScheduler } from "../ToolRuntime/AgentToolResourceScheduler.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import {
  AgentToolAssessmentStatuses,
  AgentToolExecutionStatuses,
  AgentToolOutputAvailabilities,
  readAgentToolFailure,
  type AgentToolExecutionOutcome,
} from "../ToolRuntime/AgentToolResultOutcome.js";

export interface AgentPiToolExecutionBridgeOptions {
  model: string;
  executeToolCall: AgentToolCallExecutor["execute"];
  recordToolArtifacts: AgentToolExecutionArtifactRecorder["record"];
  resourceScheduler?: Pick<AgentToolResourceScheduler, "run">;
  turnContexts: Pick<AgentPiTurnContextStore, "readToolCallBatchId" | "registerExecutedToolResult">;
}

export class AgentPiToolExecutionBridge {
  private readonly observationCompiler: AgentToolObservationContextCompiler;

  constructor(private readonly options: AgentPiToolExecutionBridgeOptions) {
    this.observationCompiler = new AgentToolObservationContextCompiler({ model: options.model });
  }

  async execute(input: AgentPiToolExecutionInput): Promise<AgentPiToolResult> {
    const operation = () => this.executeWithLease(input);
    return this.options.resourceScheduler
      ? this.options.resourceScheduler.run(input.tool, input.params, operation, input.signal)
      : operation();
  }

  private async executeWithLease(input: AgentPiToolExecutionInput): Promise<AgentPiToolResult> {
    const toolAccessGrant = input.context.toolAccessGrant;
    if (!toolAccessGrant) throw new AgentLocalizedError("toolAccess.missingGrant");
    const requestId = input.context.requestId ?? createRequestId();
    const step = input.context.step ?? 1;
    const batchId =
      this.options.turnContexts.readToolCallBatchId(input.context.piTurnContextId, input.toolCallId) ??
      `${requestId}:${step}`;
    const execution = await this.options.executeToolCall(
      {
        name: input.tool.name,
        arguments: input.params,
        expectedContractDigest: input.tool.contract?.digest ?? null,
        callId: input.toolCallId,
      },
      {
        sessionId: input.context.sessionId,
        requestId,
        step,
        onEvent: input.context.onEvent,
        toolAccessGrant,
        toolExposure: input.context.toolExposure,
        batchId,
        signal: input.signal,
        tokenBudget: input.context.tokenBudget,
      },
    );

    if (execution.kind === "AskUser") {
      return this.projectAskUser(input, batchId, execution.value);
    }

    const [recorded] = await this.options.recordToolArtifacts({
      ...(input.context.sessionId ? { sessionId: input.context.sessionId } : {}),
      requestId,
      step,
      results: execution.value,
    });
    const result = recorded ?? execution.value[0];
    if (!result) throw new Error("Tool execution completed without a result.");
    this.options.turnContexts.registerExecutedToolResult(input.context.piTurnContextId, input.toolCallId, result);
    return this.projectToolResult(input, result, batchId);
  }

  private projectAskUser(
    input: AgentPiToolExecutionInput,
    batchId: string,
    result: AskUserControlResult,
  ): AgentPiToolResult {
    const projection = input.tool.observationProjection ?? StandardAgentToolObservationProjection;
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
      input.context.tokenBudget?.availableTokens(projection.maxTokens),
    );
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(observation),
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

  private projectToolResult(
    input: AgentPiToolExecutionInput,
    result: ExecutedToolCallResult,
    batchId: string,
  ): AgentPiToolResult {
    const tool = input.tool;
    const outcome = redactArtifactToolOutcome(result.outcome, result.artifactPolicy);
    const projection = tool.observationProjection ?? StandardAgentToolObservationProjection;
    const observation = this.observationCompiler.compile(
      projectToolObservation(result, outcome, batchId),
      projection,
      input.context.tokenBudget?.availableTokens(projection.maxTokens),
    );
    const content = JSON.stringify(observation);

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
