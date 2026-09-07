import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";
import { createRequestId } from "../Core/AgentIds.js";
import { AgentCancellationError } from "../Core/AgentCancellation.js";
import { errorMessage } from "../Core/AgentErrors.js";
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
  AgentToolFailureSources,
  AgentToolAssessmentStatuses,
  AgentToolExecutionStatuses,
  AgentToolOutputAvailabilities,
  createAgentToolFailureOutcome,
  readAgentToolFailure,
  type AgentToolExecutionOutcome,
} from "../ToolRuntime/AgentToolResultOutcome.js";
import type { AgentToolObservationProjectionManifest } from "../Types/AgentToolObservationProjectionTypes.js";
import type { AgentToolTokenReservation } from "../Text/AgentTurnTokenBudget.js";
import { resolveAgentToolRuntimeCapabilities } from "../ToolRuntime/AgentToolRuntimeCapabilities.js";
import { projectAgentToolResultPresentation } from "../ToolRuntime/AgentToolResultPresentation.js";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";
import { markAgentToolArtifactUnavailable } from "../Artifacts/AgentToolArtifactAvailability.js";
import { escapeXml as escapeXmlText } from "../Prompt/AgentTurnRequestComposer.js";

export interface AgentPiToolExecutionBridgeOptions {
  model: string;
  modelSupportsImages?: boolean;
  executeToolCall: AgentToolCallExecutor["execute"];
  recordToolArtifacts: AgentToolExecutionArtifactRecorder["record"];
  executionScheduler?: Pick<AgentToolExecutionScheduler, "run">;
  /** Enables attribution="tool" wrapping of BAML observation content. */
  attributionEnabled?: () => boolean;
}

export class AgentPiToolExecutionBridge {
  private readonly observationCompiler: AgentToolObservationContextCompiler;

  constructor(private readonly options: AgentPiToolExecutionBridgeOptions) {
    this.observationCompiler = new AgentToolObservationContextCompiler({ model: options.model });
  }

  /**
   * Marks a BAML observation as tool evidence at the wire boundary. The JSON
   * payload is escaped so the envelope can never be broken by tool output.
   */
  private wrapObservationContent(content: string): string {
    if (this.options.attributionEnabled?.() !== true) return content;
    return `<observation attribution="tool">${escapeXmlText(content)}</observation>`;
  }

  async execute(input: AgentPiToolExecutionInput): Promise<AgentPiToolResult> {
    const operation = () => this.executeWithLease(input);
    const turnState = input.context.turnState;
    if (!turnState) throw new Error("Pi tool execution requires an active turn state.");
    try {
      return await (this.options.executionScheduler &&
      resolveAgentToolRuntimeCapabilities(input.tool).scheduling !== "self-managed"
        ? this.options.executionScheduler.run(turnState, input.tool, input.params, operation, input.signal)
        : operation());
    } catch (error) {
      if (isCancelledToolExecution(error, input.signal)) throw error;
      return await this.projectUncaughtFailure(input, error);
    }
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
          batchToolNames: turnState.toolBatchToolNames(input.toolCallId),
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

      let recorded: ExecutedToolCallResult[];
      try {
        recorded = await this.options.recordToolArtifacts({
          ...(artifactSessionId ? { sessionId: artifactSessionId } : {}),
          requestId,
          step,
          results: execution.value,
        });
      } catch (error) {
        if (isCancelledToolExecution(error, input.signal)) throw error;
        recorded = execution.value.map(markAgentToolArtifactUnavailable);
      }
      const [persisted] = recorded;
      const executed = execution.value[0];
      if (!persisted && !executed) throw new Error("Tool execution completed without a result.");
      const result = persisted ?? (executed ? markAgentToolArtifactUnavailable(executed) : undefined);
      if (!result) throw new Error("Tool execution did not produce a persistable result.");
      assertExecutedToolIdentity(input, result);
      turnState.registerExecutedToolResult(input.toolCallId, result);
      return await this.projectToolResult(input, result, batchId, projection, reservation);
    } catch (error) {
      if (isCancelledToolExecution(error, input.signal)) {
        reservation.release();
        throw error;
      }
      try {
        return await this.projectFailureResult(input, error, batchId, projection, reservation);
      } catch {
        reservation.release();
        throw error;
      }
    }
  }

  private async projectUncaughtFailure(input: AgentPiToolExecutionInput, error: unknown): Promise<AgentPiToolResult> {
    const turnState = input.context.turnState;
    if (!turnState) throw error;
    const projection = input.tool.observationProjection ?? StandardAgentToolObservationProjection;
    const batchId = turnState.toolBatchId(input.toolCallId);
    if (!batchId) throw error;
    let reservation: AgentToolTokenReservation | undefined;
    try {
      reservation = turnState.claimToolObservationBudget(input.toolCallId, projection.maxTokens);
      return await this.projectFailureResult(input, error, batchId, projection, reservation);
    } catch {
      reservation?.release();
      throw error;
    }
  }

  private projectFailureResult(
    input: AgentPiToolExecutionInput,
    error: unknown,
    batchId: string,
    projection: AgentToolObservationProjectionManifest,
    reservation: AgentToolTokenReservation,
  ): Promise<AgentPiToolResult> {
    const turnState = input.context.turnState;
    if (!turnState) throw error;
    const failure = {
      code: AgentExecutionErrorCodes.ToolExecutionError,
      message: errorMessage(error),
      details: {
        phase: AgentToolProcessErrorPhases.RuntimeExecution,
        toolName: input.tool.name,
      },
    };
    const executedBase: ExecutedToolCallResult = {
      callId: input.toolCallId,
      name: input.tool.name,
      arguments: input.params,
      process: {
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: "",
      },
      result: { error: failure },
      outcome: createAgentToolFailureOutcome(
        failure,
        input.tool.handler.kind === "McpTool" ? AgentToolFailureSources.Mcp : AgentToolFailureSources.Host,
        AgentToolOutputAvailabilities.None,
      ),
      artifactPolicy: input.tool.artifactPolicy,
    };
    const executed: ExecutedToolCallResult = {
      ...executedBase,
      presentation: projectAgentToolResultPresentation(executedBase),
    };
    turnState.registerExecutedToolResult(input.toolCallId, executed);
    return this.projectToolResult(input, executed, batchId, projection, reservation);
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
    const content = this.wrapObservationContent(JSON.stringify(observation));
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
    const content = this.wrapObservationContent(JSON.stringify(observation));
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

  private async projectToolResult(
    input: AgentPiToolExecutionInput,
    result: ExecutedToolCallResult,
    batchId: string,
    projection: AgentToolObservationProjectionManifest,
    reservation: AgentToolTokenReservation,
  ): Promise<AgentPiToolResult> {
    const tool = input.tool;
    const outcome = redactArtifactToolOutcome(result.outcome, result.artifactPolicy);
    const observation = this.observationCompiler.compile(
      projectToolObservation(result, outcome, batchId),
      projection,
      reservation.limit,
    );
    const content = this.wrapObservationContent(JSON.stringify(observation));
    reservation.commit(content);
    const images = await projectArtifactImages(result, this.options.modelSupportsImages === true);

    return {
      content: [
        {
          type: "text",
          text: content,
        },
        ...images,
      ],
      details: projectToolDetails(tool.name, result, outcome),
    };
  }
}

async function projectArtifactImages(result: ExecutedToolCallResult, enabled: boolean): Promise<ImageContent[]> {
  if (!enabled || !result.artifact?.assets) return [];
  const artifactRoot = path.resolve(result.artifact.artifactPath);
  const imageAssets = result.artifact.assets.filter((asset) => asset.mediaType.startsWith("image/"));
  return Promise.all(
    imageAssets.map(async (asset) => {
      const filePath = path.resolve(artifactRoot, asset.relativePath);
      const relativePath = path.relative(artifactRoot, filePath);
      if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
        throw new Error(`Tool artifact image path must remain inside its artifact: ${asset.relativePath}`);
      }
      const data = await readFile(filePath);
      return {
        type: "image",
        data: data.toString("base64"),
        mimeType: asset.mediaType,
      } satisfies ImageContent;
    }),
  );
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
    artifactAvailability: result.artifactAvailability,
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
    ...(result.artifactAvailability ? { artifactAvailability: result.artifactAvailability } : {}),
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

function isCancelledToolExecution(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || error instanceof AgentCancellationError;
}
