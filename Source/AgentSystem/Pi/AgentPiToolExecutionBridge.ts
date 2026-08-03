import { createRequestId } from "../Core/AgentIds.js";
import type { AgentToolExecutionArtifactRecorder } from "../Artifacts/AgentToolExecutionArtifactRecorder.js";
import type { AskUserControlResult } from "../ToolRuntime/AgentToolCallExecutionTypes.js";
import type { AgentToolCallExecutor } from "../ToolRuntime/AgentToolCallExecutor.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import { renderOpenAiToolObservationContent } from "../ToolRuntime/AgentToolObservationRenderer.js";
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
import { createAgentPiToolObservation } from "./AgentPiToolObservation.js";

export interface AgentPiToolExecutionBridgeOptions {
  executeToolCall: AgentToolCallExecutor["execute"];
  recordToolArtifacts: AgentToolExecutionArtifactRecorder["record"];
  resourceScheduler?: Pick<AgentToolResourceScheduler, "run">;
  turnContexts: Pick<AgentPiTurnContextStore, "readToolCallBatchId" | "registerExecutedToolResult">;
}

export class AgentPiToolExecutionBridge {
  constructor(private readonly options: AgentPiToolExecutionBridgeOptions) {}

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
      return this.projectAskUser(input.tool.name, input.toolCallId, batchId, execution.value);
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
    toolName: string,
    toolCallId: string,
    batchId: string,
    result: AskUserControlResult,
  ): AgentPiToolResult {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            createAgentPiToolObservation({
              tool_name: toolName,
              call_id: toolCallId,
              batch_id: batchId,
              status: "waiting",
              summary: result.question,
              control: result,
            }),
          ),
        },
      ],
      details: {
        senera: {
          toolName,
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
    const content = renderOpenAiToolObservationContent(
      projectToolObservation(result, outcome, batchId),
      tool.observation,
    );

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
): Record<string, unknown> {
  const error = readAgentToolFailure(outcome);
  return {
    callId: result.callId,
    batchId,
    name: result.name,
    arguments: redactArtifactSecrets(result.arguments, result.artifactPolicy),
    process: redactArtifactSecrets(result.process, result.artifactPolicy),
    outcome,
    status: outcome.assessment.status,
    execution_status: outcome.execution.status,
    output_availability: outcome.output.availability,
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
