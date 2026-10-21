import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { AgentModelUsageLedger } from "../ModelEndpoints/AgentModelUsage.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentToolAccessGrant } from "../ToolRuntime/AgentToolAccessGrant.js";
import type { AgentToolExposureState } from "../ToolRuntime/AgentToolExposureState.js";
import type { AgentTurnTokenBudget } from "../Text/AgentTurnTokenBudget.js";
import type { AgentToolTokenReservation } from "../Text/AgentTurnTokenBudget.js";
import type { ExecutedToolCallResult, ToolWorkspaceCaptureResult } from "../Types/ToolRuntimeTypes.js";
import type { AgentWorkspaceChangeObserverPort } from "../Artifacts/AgentWorkspaceChangeObserver.js";
import { requiresWorkspaceObservation } from "../Artifacts/AgentWorkspaceObservationIntent.js";
import type { AgentPiDiagnosticSink } from "./AgentPiDiagnostics.js";
import type { AgentPiPlanningSkill } from "../PiShared/AgentPiPlanningTypes.js";
import type { AgentPiToolPlanCoordinator } from "../PiShared/AgentPiToolPlanCoordinator.js";
import type { AgentExecutionApprovalMode } from "../Safety/AgentExecutionApprovalMode.js";
import type { AgentRunActivityReporter } from "../Events/AgentRunActivityReporter.js";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { AgentResourceAccessGrant } from "../Execution/SeneraResourceAccess.js";
import type { AgentBrowserTargetAuthorization } from "../Browser/AgentBrowserUrlPolicy.js";
import type { AgentResidentSpeechUtterance } from "../ResidentSpeech/AgentResidentSpeechTypes.js";
import type { AgentToolResourceLeaseOwner } from "../ToolRuntime/AgentToolResourceScheduler.js";
import type { AgentToolCapabilityCacheEntry } from "../ToolSearch/AgentToolCapabilitySessionCache.js";
import {
  AgentPiToolCallPreflightCoordinator,
  type AgentPiToolCallPreflight,
  type AgentPiToolCallPreflightInput,
  type AgentPiToolCallPreflightResult,
} from "./AgentPiToolCallPreflight.js";

export interface AgentPiTurnStateOptions {
  readonly sessionId?: string;
  readonly systemPrompt: string;
  readonly userMessage: string;
  /** Stable logical cache affinity shared by all model calls in this turn. */
  readonly logicalCacheScope?: string;
  readonly requestId: string;
  readonly step: number;
  readonly onEvent?: AgentEventSink;
  readonly diagnostics?: AgentPiDiagnosticSink;
  readonly rootCommand?: AgentRootCommand;
  readonly approvalMode: AgentExecutionApprovalMode;
  readonly toolAccessGrant: AgentToolAccessGrant;
  readonly toolExposure: AgentToolExposureState;
  readonly activeSkills: readonly AgentPiPlanningSkill[];
  readonly reusableCapabilities?: readonly AgentToolCapabilityCacheEntry[];
  /** Cross-request evidence lookup for the execution bridge; accepts dynamic
   * tools whose contract was confirmed earlier in this session. */
  readonly reusableCapabilityLookup?: (toolName: string) => AgentToolCapabilityCacheEntry | undefined;
  readonly usageLedger: AgentModelUsageLedger;
  readonly toolPlan: AgentPiToolPlanCoordinator;
  readonly tokenBudget: AgentTurnTokenBudget;
  readonly thinkingLevel?: ModelThinkingLevel;
  readonly resourceOwner?: AgentToolResourceLeaseOwner;
  readonly activityReporter?: AgentRunActivityReporter;
  readonly workspaceChangeObserver?: AgentWorkspaceChangeObserverPort;
  /** Resolves a registered tool's declarative workspace write capability. */
  readonly toolWorkspaceWritableLookup?: (toolName: string) => boolean;
}

/** Session-local mutable state shared by one Pi run and its native provider. */
export class AgentPiTurnState {
  private readonly toolPreflights = new AgentPiToolCallPreflightCoordinator();
  private readonly executedToolResultsByCallId = new Map<string, ExecutedToolCallResult>();
  private readonly executorLifecycleStatusByCallId = new Map<string, "completed" | "failed">();
  private readonly resourceAccessGrantsByCallId = new Map<string, AgentResourceAccessGrant>();
  private readonly browserTargetAuthorizationsByCallId = new Map<string, AgentBrowserTargetAuthorization>();
  private readonly residentSpeech = new Array<AgentResidentSpeechUtterance>();
  private registeredToolCalls = false;
  private wrapUpReason?: "child_deadline";
  private nextModelMessageIndex = 0;
  private readonly pendingModelMessageIndexes: number[] = [];

  constructor(readonly context: AgentPiTurnStateOptions) {}

  authorizeToolTurn(): { readonly block: boolean; readonly reason?: string } {
    if (this.wrapUpReason) {
      return {
        block: true,
        reason:
          "The child run is consolidating its existing evidence. Do not start more Tool work; return the best supported final answer now.",
      };
    }
    return { block: false };
  }

  beginModelRequest(): number {
    const modelMessageIndex = this.nextModelMessageIndex++;
    this.pendingModelMessageIndexes.push(modelMessageIndex);
    return modelMessageIndex;
  }

  claimModelMessageIndex(): number {
    const modelMessageIndex = this.pendingModelMessageIndexes.shift();
    if (modelMessageIndex === undefined) {
      throw new Error("Pi assistant message started without a registered model request.");
    }
    return modelMessageIndex;
  }

  requestWrapUp(reason: "child_deadline"): boolean {
    if (this.wrapUpReason) return false;
    this.wrapUpReason = reason;
    return true;
  }

  registerToolBatch(batchId: string, calls: readonly AgentPiToolCallPreflightInput[], fixedPayload?: unknown): void {
    const callIds = calls.map((call) => call.toolCallId);
    this.toolPreflights.register(batchId, calls);
    try {
      this.context.tokenBudget.reserveToolBatch({ callIds, fixedPayload });
      this.registeredToolCalls = true;
    } catch (error) {
      this.toolPreflights.unregister(batchId);
      throw error;
    }
  }

  beginWorkspaceChangeBatch(batchId: string, calls: readonly AgentPiToolCallPreflightInput[]): Promise<void> {
    const observedCallIds = calls
      .filter((call) =>
        requiresWorkspaceObservation(call.input, {
          workspaceWritable: this.context.toolWorkspaceWritableLookup?.(call.toolName),
        }),
      )
      .map((call) => call.toolCallId);
    return (
      (observedCallIds.length > 0
        ? this.context.workspaceChangeObserver?.beginBatch(batchId, observedCallIds)
        : undefined) ?? Promise.resolve()
    );
  }

  completeWorkspaceChangeCall(
    callId: string,
    exactPaths?: readonly string[],
  ): Promise<ToolWorkspaceCaptureResult | undefined> {
    const batchId = this.toolBatchId(callId);
    if (!batchId) return Promise.resolve(undefined);
    return (
      this.context.workspaceChangeObserver?.completeCall(batchId, callId, exactPaths) ?? Promise.resolve(undefined)
    );
  }

  skipWorkspaceChangeCall(callId: string): void {
    const batchId = this.toolBatchId(callId);
    if (batchId) this.context.workspaceChangeObserver?.skipCall(batchId, callId);
  }

  cancelWorkspaceChangeCall(callId: string): void {
    const batchId = this.toolBatchId(callId);
    if (batchId) this.context.workspaceChangeObserver?.cancelCall(batchId, callId);
  }

  cancelPendingWorkspaceChangeBatches(): void {
    this.context.workspaceChangeObserver?.cancelPendingBatches();
  }

  hasRegisteredToolCalls(): boolean {
    return this.registeredToolCalls;
  }

  recordResidentSpeech(utterance: AgentResidentSpeechUtterance): void {
    const content = utterance.content.trim();
    if (!content) throw new Error("Resident speech history cannot record an empty utterance.");
    this.residentSpeech.push({ ...utterance, content });
  }

  residentSpeechHistory(): readonly AgentResidentSpeechUtterance[] {
    return this.residentSpeech.map((utterance) => ({ ...utterance }));
  }

  preflightToolCall(
    event: AgentPiToolCallPreflightInput,
    maxConcurrentCalls: number,
    preflight: AgentPiToolCallPreflight,
  ): Promise<AgentPiToolCallPreflightResult | undefined> {
    return this.toolPreflights.run(event, maxConcurrentCalls, preflight);
  }

  claimToolObservationBudget(callId: string, maximumTokens: number): AgentToolTokenReservation {
    return this.context.tokenBudget.claimToolObservation(callId, maximumTokens);
  }

  toolObservationBudgetTokens(callId: string, maximumTokens: number): number {
    return this.context.tokenBudget.toolObservationBudgetTokens(callId, maximumTokens);
  }

  settleToolObservationBudget(callId: string, payload?: unknown): boolean {
    return this.context.tokenBudget.settleToolObservation(callId, payload);
  }

  toolBatchId(callId: string | undefined): string | undefined {
    return this.toolPreflights.batchId(callId);
  }

  toolBatchIndex(callId: string): number | undefined {
    return this.toolPreflights.batchIndex(callId);
  }

  toolBatchToolNames(callId: string | undefined): readonly string[] | undefined {
    return this.toolPreflights.batchToolNames(callId);
  }

  toolCallPurpose(callId: string): string | undefined {
    return this.toolPreflights.purpose(callId);
  }

  toolModelMessageIndex(callId: string): number | undefined {
    return this.toolPreflights.call(callId)?.modelMessageIndex;
  }

  toolModelContentIndex(callId: string): number | undefined {
    return this.toolPreflights.call(callId)?.modelContentIndex;
  }

  registerResourceAccessGrant(callId: string, grant: AgentResourceAccessGrant): void {
    if (!this.toolPreflights.batchId(callId)) {
      throw new Error(`Pi tool call ${callId} is not registered in an active tool batch.`);
    }
    this.resourceAccessGrantsByCallId.set(callId, grant);
  }

  takeResourceAccessGrant(callId: string): AgentResourceAccessGrant | undefined {
    const grant = this.resourceAccessGrantsByCallId.get(callId);
    this.resourceAccessGrantsByCallId.delete(callId);
    return grant;
  }

  registerBrowserTargetAuthorization(callId: string, authorization: AgentBrowserTargetAuthorization): void {
    if (!this.toolPreflights.batchId(callId)) {
      throw new Error(`Pi tool call ${callId} is not registered in an active tool batch.`);
    }
    this.browserTargetAuthorizationsByCallId.set(callId, authorization);
  }

  takeBrowserTargetAuthorization(callId: string): AgentBrowserTargetAuthorization | undefined {
    const authorization = this.browserTargetAuthorizationsByCallId.get(callId);
    this.browserTargetAuthorizationsByCallId.delete(callId);
    return authorization;
  }

  recordExecutorLifecycleStatus(callId: string, status: "completed" | "failed"): void {
    this.executorLifecycleStatusByCallId.set(callId, status);
  }

  executorLifecycleStatus(callId: string): "completed" | "failed" | undefined {
    return this.executorLifecycleStatusByCallId.get(callId);
  }

  registerExecutedToolResult(callId: string, result: ExecutedToolCallResult): void {
    this.executedToolResultsByCallId.set(callId, result);
  }

  takeExecutedToolResult(callId: string): ExecutedToolCallResult | undefined {
    const result = this.executedToolResultsByCallId.get(callId);
    this.executedToolResultsByCallId.delete(callId);
    return result;
  }
}
