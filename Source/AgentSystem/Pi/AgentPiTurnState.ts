import type { AgentEventSink } from "../Events/AgentEvent.js";
import type { AgentModelUsageLedger } from "../ModelEndpoints/AgentModelUsage.js";
import type { AgentRootCommand } from "../AgentRootCommand.js";
import type { AgentToolAccessGrant } from "../ToolRuntime/AgentToolAccessGrant.js";
import type { AgentToolExposureState } from "../ToolRuntime/AgentToolExposureState.js";
import type { AgentTurnTokenBudget } from "../Text/AgentTurnTokenBudget.js";
import type { AgentToolTokenReservation } from "../Text/AgentTurnTokenBudget.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import type { AgentPiDiagnosticSink } from "./AgentPiDiagnostics.js";
import type { AgentPiPlanningSkill } from "../PiShared/AgentPiPlanningTypes.js";
import type { AgentPiToolPlanCoordinator } from "../PiShared/AgentPiToolPlanCoordinator.js";
import type { AgentExecutionApprovalMode } from "../Safety/AgentExecutionApprovalMode.js";
import type { AgentRunActivityReporter } from "../Events/AgentRunActivityReporter.js";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { AgentResourceAccessGrant } from "../Execution/SeneraResourceAccess.js";
import type { AgentResidentSpeechUtterance } from "../ResidentSpeech/AgentResidentSpeechTypes.js";
import type { AgentToolResourceLeaseOwner } from "../ToolRuntime/AgentToolResourceScheduler.js";
import type { AgentToolCapabilityCacheEntry } from "../ToolSearch/AgentToolCapabilitySessionCache.js";
import {
  addAgentResidentSignal,
  composeAgentResidentStanceSignals,
  EmptyAgentResidentSignalCounts,
  type AgentResidentSignalCounts,
} from "../Continuity/AgentResidentSignalAggregator.js";
import { nextResidentState, type AgentResidentState } from "../Continuity/AgentResidentState.js";
import {
  AgentPiToolCallPreflightCoordinator,
  type AgentPiToolCallPreflight,
  type AgentPiToolCallPreflightInput,
  type AgentPiToolCallPreflightResult,
} from "./AgentPiToolCallPreflight.js";

export interface AgentPiTurnStateOptions {
  readonly sessionId?: string;
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
  /** Host-derived resident stance entering this turn; used to derive the live in-turn stance. */
  readonly seedResidentState?: AgentResidentState;
}

/** Session-local mutable state shared by one Pi run and its native provider. */
export class AgentPiTurnState {
  private readonly toolPreflights = new AgentPiToolCallPreflightCoordinator();
  private readonly executedToolResultsByCallId = new Map<string, ExecutedToolCallResult>();
  private readonly executorLifecycleStatusByCallId = new Map<string, "completed" | "failed">();
  private readonly resourceAccessGrantsByCallId = new Map<string, AgentResourceAccessGrant>();
  private readonly residentSpeech = new Array<AgentResidentSpeechUtterance>();
  private residentStanceCounts: AgentResidentSignalCounts = EmptyAgentResidentSignalCounts;
  private registeredToolCalls = false;
  private wrapUpReason?: "child_deadline";

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

  toolObservationBudgetLimit(callId: string, maximumTokens: number): number {
    return this.context.tokenBudget.toolObservationLimit(callId, maximumTokens);
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

  recordExecutorLifecycleStatus(callId: string, status: "completed" | "failed"): void {
    this.executorLifecycleStatusByCallId.set(callId, status);
  }

  executorLifecycleStatus(callId: string): "completed" | "failed" | undefined {
    return this.executorLifecycleStatusByCallId.get(callId);
  }

  registerExecutedToolResult(callId: string, result: ExecutedToolCallResult): void {
    this.executedToolResultsByCallId.set(callId, result);
    this.residentStanceCounts = addAgentResidentSignal(this.residentStanceCounts, result);
  }

  /**
   * The resident's live in-turn stance: the durable seed advanced by the tool
   * outcomes observed so far, using the same pure transition as end-of-turn
   * persistence. Undefined when no seed state was provided (continuity off).
   */
  currentResidentStance(): AgentResidentState | undefined {
    const seed = this.context.seedResidentState;
    if (!seed) return undefined;
    return nextResidentState(
      seed,
      composeAgentResidentStanceSignals({ bearing: seed.bearing, counts: this.residentStanceCounts }),
    );
  }

  takeExecutedToolResult(callId: string): ExecutedToolCallResult | undefined {
    const result = this.executedToolResultsByCallId.get(callId);
    this.executedToolResultsByCallId.delete(callId);
    return result;
  }
}
