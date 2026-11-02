import { createRequestId } from "../Core/AgentIds.js";
import { withAgentModelDiagnosticScope } from "../Diagnostics/AgentModelDiagnosticScope.js";
import { projectAgentPiJsonValue } from "./AgentPiJsonValue.js";
import { withEventContext } from "../Events/AgentEvent.js";
import { AgentCancellationError, awaitWithAbortSignal } from "../Core/AgentCancellation.js";
import { errorMessage } from "../Core/AgentErrors.js";
import type { AgentToolExecutionArtifactRecorder } from "../Artifacts/AgentToolExecutionArtifactRecorder.js";
import { AgentToolSourceViewInvariantError } from "../Artifacts/AgentToolSourceView.js";
import type { SuspendChildRunControlResult } from "../ToolRuntime/AgentToolCallExecutionTypes.js";
import type { AgentToolCallExecutor } from "../ToolRuntime/AgentToolCallExecutor.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import { redactArtifactSecrets, redactArtifactToolOutcome } from "../Artifacts/AgentArtifactRedaction.js";
import { AgentPiToolResultStatuses, type AgentPiToolExecutionInput, type AgentPiToolResult } from "./AgentPiTypes.js";
import type { AgentToolExecutionScheduler } from "../ToolRuntime/AgentToolExecutionScheduler.js";
import type { AgentToolResourceLeaseOwner } from "../ToolRuntime/AgentToolResourceScheduler.js";
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
import type { AgentToolTokenReservation } from "../Text/AgentTurnTokenBudget.js";
import type { AgentToolResultObservationCompressor } from "../ToolRuntime/AgentToolResultObservationCompressor.js";
import { resolveAgentToolRuntimeCapabilities } from "../ToolRuntime/AgentToolRuntimeCapabilities.js";
import { projectAgentToolResultPresentation } from "../ToolRuntime/AgentToolResultPresentation.js";
import { AgentExecutionErrorCodes, AgentToolProcessErrorPhases } from "../Xml/AgentXmlStatus.js";
import { markAgentToolArtifactUnavailable } from "../Artifacts/AgentToolArtifactAvailability.js";
import { escapeXml as escapeXmlText } from "../Prompt/AgentTurnRequestComposer.js";
import { projectAgentToolCapabilityArguments } from "../ToolSearch/AgentToolCapabilityArgumentProjection.js";
import { mergeAgentWorkspaceCaptures } from "../Artifacts/AgentWorkspaceChangeCapture.js";
import { sanitizeAgentPiToolResultMedia } from "./AgentPiToolResultMediaSanitizer.js";
import { projectAgentPiWorkspaceToolContext } from "./AgentPiWorkspaceContext.js";
import { retainDeliveredToolContractReceipts } from "../ToolSearch/AgentToolContractDelivery.js";
import { createAgentToolExecutionDigest } from "../ToolContracts/AgentToolContractIdentity.js";

export interface AgentPiToolExecutionBridgeOptions {
  model: string;
  observationTokenBudget: number;
  observationCompressor: AgentToolResultObservationCompressor;
  executeToolCall: AgentToolCallExecutor["execute"];
  recordToolArtifacts: AgentToolExecutionArtifactRecorder["record"];
  executionScheduler?: Pick<AgentToolExecutionScheduler, "run">;
  /**
   * Wraps observation content in the BAML attribution envelope. Only the BAML
   * XML wire renders tool observations as attributed text; native tool results
   * stay as the bare JSON observation protocol.
   */
  observationAttribution?: boolean;
}

export class AgentPiToolExecutionBridge {
  constructor(private readonly options: AgentPiToolExecutionBridgeOptions) {}

  /**
   * Marks a BAML observation as tool evidence at the wire boundary. The JSON
   * payload is escaped so the envelope can never be broken by tool output.
   */
  private wrapObservationContent(content: string): string {
    if (this.options.observationAttribution !== true) return content;
    return `<observation attribution="tool">${escapeXmlText(content)}</observation>`;
  }

  async execute(input: AgentPiToolExecutionInput): Promise<AgentPiToolResult> {
    const parentToolCallId = input.context.turnState?.parentToolCallId(input.toolCallId);
    const effectiveInput: AgentPiToolExecutionInput = {
      ...input,
      context: parentToolCallId
        ? {
            ...input.context,
            onEvent: (event) => input.context.onEvent?.(withEventContext(event, { scope: { parentToolCallId } })),
          }
        : input.context,
      params: projectAgentToolCapabilityArguments(
        input.tool,
        input.params,
        input.context.turnState?.context.reusableCapabilities,
      ),
    };
    const turnState = input.context.turnState;
    if (!turnState) throw new Error("Pi tool execution requires an active turn state.");
    try {
      return await withAgentModelDiagnosticScope(
        {
          context: {
            sessionId: input.context.sessionId,
            requestId: input.context.requestId,
            step: input.context.step,
            toolCallId: input.toolCallId,
          },
        },
        () => this.executeWithLease(effectiveInput),
      );
    } catch (error) {
      if (isCancelledToolExecution(error, effectiveInput.signal)) {
        turnState.cancelWorkspaceChangeCall(input.toolCallId);
        throw error;
      }
      return await this.projectUncaughtFailure(effectiveInput, error);
    }
  }

  private async executeWithLease(input: AgentPiToolExecutionInput): Promise<AgentPiToolResult> {
    const toolAccessGrant = input.context.toolAccessGrant;
    if (!toolAccessGrant) throw new AgentLocalizedError("toolAccess.missingGrant");
    const turnState = input.context.turnState;
    if (!turnState) throw new Error("Pi tool execution requires an active turn state.");
    const sessionId = input.context.sessionId ?? turnState.context.sessionId;
    const artifactSessionId = input.context.sessionId ?? turnState.context.sessionId;
    const requestId = input.context.requestId ?? turnState.context.requestId ?? createRequestId();
    const step = input.context.step ?? turnState.context.step ?? 1;
    const batchId = turnState.toolBatchId(input.toolCallId);
    if (!batchId) throw new Error(`Pi tool call ${input.toolCallId} is not registered in a tool batch.`);
    const reservation = turnState.claimToolObservationBudget(input.toolCallId, this.options.observationTokenBudget);
    let workspaceCapture: ExecutedToolCallResult["workspaceCapture"];
    let workspaceObservationCompleted = false;
    try {
      const execute = () =>
        this.options.executeToolCall(
          {
            name: input.tool.name,
            arguments: input.params,
            expectedExecutionDigest: createAgentToolExecutionDigest(input.tool),
            callId: input.toolCallId,
            index: turnState.toolBatchIndex(input.toolCallId),
          },
          {
            sessionId,
            interaction: input.context.interaction,
            logicalCacheScope: turnState.context.logicalCacheScope,
            requestId,
            step,
            onEvent: input.context.onEvent,
            toolAccessGrant,
            resourceAccessGrant: turnState.takeResourceAccessGrant(input.toolCallId),
            browserTargetAuthorization: turnState.takeBrowserTargetAuthorization(input.toolCallId),
            toolExposure: input.context.toolExposure,
            batchId,
            batchToolNames: turnState.toolBatchToolNames(input.toolCallId),
            modelMessageIndex: turnState.toolModelMessageIndex(input.toolCallId),
            modelContentIndex: turnState.toolModelContentIndex(input.toolCallId),
            signal: input.signal,
            tokenBudget: reservation,
            approvalMode: input.context.approvalMode,
            activeSkills: input.context.activeSkills,
            reusableCapabilities: turnState.context.reusableCapabilities,
            thinkingLevel: input.context.thinkingLevel,
            onLifecycleSettled: (status) => turnState.recordExecutorLifecycleStatus(input.toolCallId, status),
            deferResultDetail: true,
            workspaceObservation: turnState.context.workspaceChangeObserver,
            composition: input.composition,
          },
        );
      const execution = await (this.options.executionScheduler &&
      resolveAgentToolRuntimeCapabilities(input.tool).scheduling !== "self-managed"
        ? this.options.executionScheduler.run(
            turnState,
            input.tool,
            input.params,
            execute,
            input.signal,
            projectToolResourceOwner(input, turnState),
          )
        : execute());

      if (turnState.parentToolCallId(input.toolCallId) && execution.kind !== "ToolResults") {
        throw new Error(
          "A composed tool cannot suspend inference; declare it as Composition: model-only and invoke it directly.",
        );
      }
      if (execution.kind === "SuspendChildRun") {
        turnState.skipWorkspaceChangeCall(input.toolCallId);
        return await this.projectChildRunSuspension(input, execution.value, reservation);
      }

      const resourceObservation = execution.value.find((result) => result.workspaceObservation);
      const exactPaths = execution.value.flatMap((result) =>
        result.workspaceCapture?.source === "mutation-receipt"
          ? result.workspaceCapture.changes.map((change) => change.path)
          : [],
      );
      const batchCapture = await awaitWithAbortSignal(
        turnState.completeWorkspaceChangeCall(input.toolCallId, exactPaths),
        input.signal,
      );
      workspaceCapture =
        resourceObservation?.workspaceObservation?.state === "active"
          ? resourceObservation.workspaceCapture
          : mergeAgentWorkspaceCaptures(batchCapture, resourceObservation?.workspaceCapture);
      workspaceObservationCompleted = true;
      const executionResults = execution.value.map((result, index) =>
        index === 0
          ? {
              ...result,
              workspaceCapture: mergeAgentWorkspaceCaptures(result.workspaceCapture, workspaceCapture),
            }
          : result,
      );

      let recorded: ExecutedToolCallResult[];
      try {
        recorded = await this.options.recordToolArtifacts({
          ...(artifactSessionId ? { sessionId: artifactSessionId } : {}),
          requestId,
          step,
          results: executionResults,
        });
      } catch (error) {
        if (isCancelledToolExecution(error, input.signal)) throw error;
        if (error instanceof AgentToolSourceViewInvariantError) throw error;
        recorded = executionResults.map(markAgentToolArtifactUnavailable);
      }
      const [persisted] = recorded;
      const executed = executionResults[0];
      if (!persisted && !executed) throw new Error("Tool execution completed without a result.");
      const result = persisted ?? (executed ? markAgentToolArtifactUnavailable(executed) : undefined);
      if (!result) throw new Error("Tool execution did not produce a persistable result.");
      assertExecutedToolIdentity(input, result);
      turnState.registerExecutedToolResult(input.toolCallId, result);
      const projected = await this.projectToolResult(input, result, executed ?? result, reservation);
      return execution.kind === "SuspendRun" ? { ...projected, terminate: true } : projected;
    } catch (error) {
      if (isCancelledToolExecution(error, input.signal)) {
        turnState.cancelWorkspaceChangeCall(input.toolCallId);
        reservation.release();
        throw error;
      }
      try {
        if (!workspaceObservationCompleted) {
          workspaceCapture = await awaitWithAbortSignal(
            turnState.completeWorkspaceChangeCall(input.toolCallId),
            input.signal,
          );
        }
        return await this.projectFailureResult(input, error, reservation, workspaceCapture);
      } catch {
        reservation.release();
        throw error;
      }
    }
  }

  private async projectUncaughtFailure(input: AgentPiToolExecutionInput, error: unknown): Promise<AgentPiToolResult> {
    const turnState = input.context.turnState;
    if (!turnState) throw error;
    if (!turnState.toolBatchId(input.toolCallId)) throw error;
    let reservation: AgentToolTokenReservation | undefined;
    try {
      reservation = turnState.claimToolObservationBudget(input.toolCallId, this.options.observationTokenBudget);
      const workspaceCapture = await awaitWithAbortSignal(
        turnState.completeWorkspaceChangeCall(input.toolCallId),
        input.signal,
      );
      return await this.projectFailureResult(input, error, reservation, workspaceCapture);
    } catch {
      reservation?.release();
      throw error;
    }
  }

  private async projectFailureResult(
    input: AgentPiToolExecutionInput,
    error: unknown,
    reservation: AgentToolTokenReservation,
    workspaceCapture?: ExecutedToolCallResult["workspaceCapture"],
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
      ...(workspaceCapture ? { workspaceCapture } : {}),
      ...(input.tool.runtime.ResultStorage ? { resultStorage: input.tool.runtime.ResultStorage } : {}),
    };
    let executedResult = executedBase;
    if (workspaceCapture) {
      const artifactSessionId = input.context.sessionId ?? turnState.context.sessionId;
      try {
        const [recorded] = await this.options.recordToolArtifacts({
          ...(artifactSessionId ? { sessionId: artifactSessionId } : {}),
          requestId: input.context.requestId ?? turnState.context.requestId ?? createRequestId(),
          step: input.context.step ?? turnState.context.step ?? 1,
          results: [executedBase],
        });
        if (recorded) executedResult = recorded;
      } catch (recordError) {
        if (isCancelledToolExecution(recordError, input.signal)) throw recordError;
        executedResult = markAgentToolArtifactUnavailable(executedBase);
      }
    }
    const executed: ExecutedToolCallResult = {
      ...executedResult,
      presentation: projectAgentToolResultPresentation(executedResult),
    };
    turnState.registerExecutedToolResult(input.toolCallId, executed);
    return this.projectToolResult(input, executed, executed, reservation);
  }

  private async projectChildRunSuspension(
    input: AgentPiToolExecutionInput,
    result: SuspendChildRunControlResult,
    reservation: AgentToolTokenReservation,
  ): Promise<AgentPiToolResult> {
    const observation = await this.options.observationCompressor.compress({
      requestId: input.toolCallId,
      toolName: input.tool.name,
      status: "waiting",
      executionStatus: AgentToolExecutionStatuses.Completed,
      outputAvailability: AgentToolOutputAvailabilities.Complete,
      arguments: input.params,
      process: undefined,
      outcome: undefined,
      result,
      systemPrompt: input.context.turnState?.context.systemPrompt ?? "",
      currentUserMessage: input.context.turnState?.context.userMessage ?? "",
      observationBudgetTokens: reservation.observationBudgetTokens,
      signal: input.signal,
    });
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
    rawResult: ExecutedToolCallResult,
    reservation: AgentToolTokenReservation,
  ): Promise<AgentPiToolResult> {
    const tool = input.tool;
    const outcome = redactArtifactToolOutcome(result.outcome, result.artifactPolicy);
    const observedResult = sanitizeAgentPiToolResultMedia(redactArtifactSecrets(result.result, result.artifactPolicy));
    const turnState = input.context.turnState;
    if (!turnState) throw new Error("Pi tool observation requires an active turn state.");
    if (turnState.parentToolCallId(input.toolCallId)) {
      return {
        content: readAgentToolFailure(outcome)
          ? [{ type: "text", text: JSON.stringify(readAgentToolFailure(outcome)) }]
          : [],
        structuredContent: projectAgentPiJsonValue(observedResult.result ?? null),
        details: projectToolDetails(tool.name, result, outcome, result.toolContractReceipts ?? []),
        isError: outcome.assessment.status === AgentPiToolResultStatuses.Failure,
      };
    }
    const observationInput = {
      requestId: input.toolCallId,
      toolName: result.name,
      status: outcome.assessment.status,
      executionStatus: outcome.execution.status,
      outputAvailability: outcome.output.availability,
      arguments: redactArtifactSecrets(rawResult.arguments, rawResult.artifactPolicy),
      process: redactArtifactSecrets(rawResult.process, rawResult.artifactPolicy),
      outcome,
      result: observedResult.result,
      resultSchema: tool.contract?.outputSchema,
      perception: tool.perception,
      ...(readAgentToolFailure(outcome) ? { error: readAgentToolFailure(outcome) } : {}),
      ...(result.artifact ? { artifact: result.artifact } : {}),
      ...(result.sourceArtifacts ? { sourceArtifacts: result.sourceArtifacts } : {}),
      ...(result.artifactAvailability ? { artifactAvailability: result.artifactAvailability } : {}),
      systemPrompt: turnState.context.systemPrompt,
      currentUserMessage: turnState.context.userMessage,
      query: turnState.toolCallPurpose(input.toolCallId),
      notice: [input.notice, observedResult.notice]
        .filter((value): value is string => Boolean(value?.trim()))
        .join(" "),
      observationBudgetTokens: reservation.observationBudgetTokens,
      signal: input.signal,
    };
    let observation;
    try {
      observation = await this.options.observationCompressor.compress(observationInput);
    } catch (error) {
      if (isCancelledToolExecution(error, input.signal)) throw error;
      // Observation rendering is downstream of execution and publication.
      // A failed derived view must never rewrite the completed tool outcome.
      observation = this.options.observationCompressor.pressure(observationInput, "observation_projection_failed", {
        notice: "Tool execution outcome is preserved; its derived observation could not be rendered.",
      });
    }
    const content = this.wrapObservationContent(JSON.stringify(observation));
    reservation.commit(content);

    return {
      content: [{ type: "text", text: content }],
      details: projectToolDetails(
        tool.name,
        result,
        outcome,
        retainDeliveredToolContractReceipts(result.toolContractReceipts ?? [], observation.detail.result),
      ),
    };
  }
}

function projectToolResourceOwner(
  input: AgentPiToolExecutionInput,
  turnState: NonNullable<AgentPiToolExecutionInput["context"]["turnState"]>,
): AgentToolResourceLeaseOwner | undefined {
  const sessionId = input.context.sessionId ?? turnState.context.sessionId;
  if (!sessionId) return undefined;
  const parent = turnState.context.resourceOwner;
  return {
    type: "tool_call",
    id: input.toolCallId,
    ...(parent ? { parent } : {}),
  };
}

function assertExecutedToolIdentity(input: AgentPiToolExecutionInput, result: ExecutedToolCallResult): void {
  if (result.callId !== input.toolCallId || result.name !== input.tool.name) {
    throw new Error(`Executed tool result identity does not match Pi call ${input.toolCallId}.`);
  }
}

function projectToolDetails(
  toolName: string,
  result: ExecutedToolCallResult,
  outcome: AgentToolExecutionOutcome,
  toolContractReceipts: NonNullable<ExecutedToolCallResult["toolContractReceipts"]> = [],
): AgentPiToolResult["details"] {
  const context = {
    toolName,
    artifactUri: result.artifact?.artifactUri,
    ...(result.artifactAvailability ? { artifactAvailability: result.artifactAvailability } : {}),
    callId: result.callId,
    ...(toolContractReceipts.length ? { toolContractReceipts: [...toolContractReceipts] } : {}),
    workspaceContext: projectAgentPiWorkspaceToolContext(result),
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
