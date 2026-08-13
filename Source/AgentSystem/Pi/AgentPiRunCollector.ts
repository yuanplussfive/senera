import type { StopReason } from "@earendil-works/pi-ai";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { readAgentUnknownRecord as readRecord } from "../Core/AgentUnknownValue.js";
import { AgentEventKinds, type AgentDomainEvent, type AgentEventSink } from "../Events/AgentEvent.js";
import { emitAgentEvent } from "../Events/AgentEvent.js";
import { AgentLoopEventFactory } from "../Loop/AgentLoopEventFactory.js";
import { clampField, type StepTrace } from "../Core/AgentStepTrace.js";
import type { ExecutedToolCallResult } from "../Types/ToolRuntimeTypes.js";
import { projectAgentToolResultPresentation } from "../ToolRuntime/AgentToolResultPresentation.js";
import type { AgentPiTurnState } from "./AgentPiTurnState.js";
import { AgentRunActivities } from "../Events/AgentRunEventTypes.js";
import {
  AgentRunActivityReporter,
  type AgentRunActivityClock,
  type AgentRunActivityHandle,
} from "../Events/AgentRunActivityReporter.js";
import { SystemAgentLifecycleClock } from "../Events/AgentLifecycleClock.js";
import {
  emitAgentPiDiagnostic,
  projectPiSessionDiagnosticEvent,
  type AgentPiDiagnosticSink,
} from "../Diagnostics/AgentPiDiagnostics.js";
import { AgentPiCompactionActivityObserver } from "./AgentPiCompactionActivityObserver.js";
import { isAgentPiCompactionLifecycleEvent, isAgentPiRunEvent, type AgentPiRunEvent } from "./AgentPiSessionEvents.js";

export interface AgentPiRunCollectorOptions {
  sessionId?: string;
  requestId: string;
  step: number;
  onEvent?: AgentEventSink;
  diagnostics?: AgentPiDiagnosticSink;
  streamModelDeltas?: boolean;
  turnState: AgentPiTurnState;
  activityReporter?: AgentRunActivityReporter;
  onFinalResponseAvailable?: (content: string) => void | Promise<void>;
  /** Clock used to stamp tool spans; tests may provide a deterministic implementation. */
  clock?: AgentRunActivityClock;
}

export interface AgentPiRunProjection {
  traces: StepTrace[];
  executedTools: ExecutedToolCallResult[];
}

interface ActiveToolTrace {
  seq: number;
  toolName: string;
  callId: string;
  args: unknown;
  startedAtMonotonic?: number;
  startedAt?: string;
}

export class AgentPiRunCollector {
  private readonly eventFactory = new AgentLoopEventFactory();
  private readonly activityReporter: AgentRunActivityReporter;
  private readonly compactionActivity: AgentPiCompactionActivityObserver;
  private readonly clock: AgentRunActivityClock;
  private readonly traces: StepTrace[] = [];
  private readonly activeToolTraces = new Map<string, ActiveToolTrace>();
  private readonly executedTools: ExecutedToolCallResult[] = [];
  private pending = Promise.resolve();
  private textDelta = "";
  private activeAssistantResponse?: AgentRunActivityHandle;
  private finalResponsePublished = false;

  constructor(private readonly options: AgentPiRunCollectorOptions) {
    this.clock = options.clock ?? SystemAgentLifecycleClock;
    this.activityReporter =
      options.activityReporter ??
      new AgentRunActivityReporter({
        sessionId: options.sessionId,
        requestId: options.requestId,
        step: options.step,
        onEvent: options.onEvent,
      });
    this.compactionActivity = new AgentPiCompactionActivityObserver(this.activityReporter);
  }

  collect(event: AgentSessionEvent): Promise<void> {
    this.pending = this.pending.then(
      () => this.projectEvent(event),
      () => this.projectEvent(event),
    );
    return this.pending;
  }

  async drain(): Promise<void> {
    await this.pending;
  }

  snapshot(): AgentPiRunProjection {
    return {
      traces: [...this.traces],
      executedTools: [...this.executedTools],
    };
  }

  private async projectEvent(event: AgentSessionEvent): Promise<void> {
    if (isAgentPiCompactionLifecycleEvent(event)) {
      await this.compactionActivity.observe(event);
      return;
    }
    if (!isAgentPiRunEvent(event)) return;

    if (event.type !== "message_update") {
      await emitAgentPiDiagnostic(
        this.options.diagnostics,
        projectPiSessionDiagnosticEvent({
          context: {
            sessionId: this.options.sessionId,
            requestId: this.options.requestId,
            step: this.options.step,
          },
          event,
        }),
      );
    }

    switch (event.type) {
      case "message_start":
        await this.messageStarted(event);
        break;
      case "message_update": {
        const projected = this.messageUpdated(event);
        if (projected) await this.emit(projected);
        break;
      }
      case "message_end":
        await this.messageEnded(event);
        break;
      case "tool_execution_start":
        this.toolExecutionStarted(event);
        break;
      case "tool_execution_end":
        for (const projected of this.toolExecutionEnded(event)) {
          await this.emit(projected);
        }
        break;
    }
  }

  private async messageStarted(event: Extract<AgentPiRunEvent, { type: "message_start" }>): Promise<void> {
    if (event.message.role !== "assistant") return;
    if (this.activeAssistantResponse) {
      throw new Error("Pi emitted overlapping assistant message lifecycles.");
    }
    this.textDelta = "";
    this.activeAssistantResponse = await this.activityReporter.start(AgentRunActivities.GeneratingResponse);
  }

  private async messageEnded(event: Extract<AgentPiRunEvent, { type: "message_end" }>): Promise<void> {
    if (event.message.role !== "assistant") return;
    const activity = this.activeAssistantResponse;
    this.activeAssistantResponse = undefined;
    await activity?.complete();
    if (this.finalResponsePublished || !isFinalAssistantResponse(event.message.stopReason)) return;
    const content = extractText(event.message).trim();
    if (!content) return;
    this.finalResponsePublished = true;
    await this.options.onFinalResponseAvailable?.(content);
  }

  private toolExecutionStarted(event: Extract<AgentPiRunEvent, { type: "tool_execution_start" }>): void {
    const seq = this.traces.length + this.activeToolTraces.size;
    const startedAtEpoch = this.clock.now();
    const startedAtMonotonic = this.clock.monotonicNow();
    const startedAt = this.clock.timestamp(startedAtEpoch);
    this.activeToolTraces.set(event.toolCallId, {
      seq,
      toolName: event.toolName,
      callId: event.toolCallId,
      args: event.args,
      startedAtMonotonic,
      startedAt,
    });
  }

  private toolExecutionEnded(
    event: Extract<AgentPiRunEvent, { type: "tool_execution_end" }>,
  ): readonly AgentDomainEvent[] {
    const active = this.activeToolTraces.get(event.toolCallId) ?? readMissingToolTrace(event, this.traces.length);
    this.activeToolTraces.delete(event.toolCallId);

    const captured = this.options.turnState.takeExecutedToolResult(event.toolCallId);
    const presentation =
      captured?.presentation ?? (captured ? projectAgentToolResultPresentation(captured) : undefined);
    const executed = captured && presentation ? { ...captured, presentation } : captured;
    if (executed) {
      this.executedTools.push(executed);
    }
    const trace = this.buildToolTrace(active, event, executed);
    this.traces.push(trace);
    const lifecycleTiming =
      active.startedAtMonotonic === undefined || active.startedAt === undefined
        ? {}
        : {
            startedAt: active.startedAt,
            durationMs: Math.max(0, Math.round(this.clock.monotonicNow() - active.startedAtMonotonic)),
          };

    const lifecycle = event.isError
      ? this.eventFactory.toolCallFailed(
          this.options.requestId,
          this.options.step,
          active.seq,
          event.toolName,
          event.toolCallId,
          readToolErrorMessage(event.result),
          undefined,
          {
            batchId: this.batchIdFor(event.toolCallId),
            ...lifecycleTiming,
          },
        )
      : this.eventFactory.toolCallCompleted(
          this.options.requestId,
          this.options.step,
          active.seq,
          event.toolName,
          event.toolCallId,
          presentation,
          {
            batchId: this.batchIdFor(event.toolCallId),
            ...lifecycleTiming,
          },
        );
    const resultDetail = this.eventFactory.toolCallResultDetail(
      this.options.requestId,
      this.options.step,
      active.seq,
      event.toolName,
      event.toolCallId,
      executed ?? event.result,
      { batchId: this.batchIdFor(event.toolCallId) },
    );
    const executorStatus = this.options.turnState.executorLifecycleStatus(event.toolCallId);
    const piStatus = event.isError ? "failed" : "completed";
    // The executor lifecycle is already published before Pi emits tool_execution_end.
    // A later Pi success must not overwrite a host-confirmed failure and create two
    // terminal events for the same call. Pi failures still supersede an earlier
    // executor success because post-execution finalization can discover new errors.
    if (executorStatus === piStatus || (executorStatus === "failed" && piStatus === "completed")) {
      return [resultDetail];
    }
    return [lifecycle, resultDetail];
  }

  private messageUpdated(event: Extract<AgentPiRunEvent, { type: "message_update" }>): AgentDomainEvent | undefined {
    if (this.options.streamModelDeltas === false) {
      return undefined;
    }

    const text = extractText(event.message);
    if (text.length <= this.textDelta.length || !text.startsWith(this.textDelta)) {
      this.textDelta = text;
      return undefined;
    }

    const delta = text.slice(this.textDelta.length);
    this.textDelta = text;
    return delta.length > 0
      ? {
          kind: AgentEventKinds.ModelDelta,
          context: {
            requestId: this.options.requestId,
            step: this.options.step,
          },
          data: {
            text: delta,
          },
        }
      : undefined;
  }

  private buildToolTrace(
    active: ActiveToolTrace,
    event: Extract<AgentPiRunEvent, { type: "tool_execution_end" }>,
    executed: ExecutedToolCallResult | undefined,
  ): StepTrace {
    return {
      step: this.options.step,
      seq: active.seq,
      kind: "tool",
      status: event.isError ? "failed" : "done",
      toolName: event.toolName,
      callId: event.toolCallId,
      batchId: this.batchIdFor(event.toolCallId),
      purpose: this.options.turnState.toolCallPurpose(event.toolCallId),
      toolArgs: clampField(executed?.arguments ?? active.args),
      toolPreview: executed?.presentation?.headline,
      toolPresentation: executed?.presentation,
      toolResult: clampField(executed?.result ?? event.result),
      toolErrorMessage: event.isError ? readToolErrorMessage(event.result) : undefined,
    };
  }

  private batchIdFor(callId: string): string | undefined {
    return this.options.turnState.toolBatchId(callId);
  }

  private async emit(event: AgentDomainEvent): Promise<void> {
    await emitAgentEvent(this.options.onEvent, event);
  }
}

function readToolErrorMessage(value: unknown): string {
  return readFirstTextContent(value) ?? "Pi 工具执行失败。";
}

function readFirstTextContent(value: unknown): string | undefined {
  const content = readRecord(value)?.content;
  if (!Array.isArray(content)) {
    return undefined;
  }
  const text = content
    .map((entry) => readRecord(entry))
    .find((entry) => entry?.type === "text" && typeof entry.text === "string")?.text;
  return typeof text === "string" && text.length > 0 ? text : undefined;
}

function extractText(message: unknown): string {
  const record = readRecord(message);
  const content = record?.content;
  return Array.isArray(content)
    ? content
        .flatMap((entry) => {
          const item = readRecord(entry);
          return item?.type === "text" && typeof item.text === "string" ? [item.text] : [];
        })
        .join("")
    : "";
}

const VisibleAssistantResponseStopReasons = new Set<StopReason>(["stop", "length"]);

function isFinalAssistantResponse(stopReason: StopReason): boolean {
  return VisibleAssistantResponseStopReasons.has(stopReason);
}

function readMissingToolTrace(
  event: Extract<AgentPiRunEvent, { type: "tool_execution_end" }>,
  seq: number,
): ActiveToolTrace {
  return {
    seq,
    toolName: event.toolName,
    callId: event.toolCallId,
    args: undefined,
  };
}
