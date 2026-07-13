import type { AgentEvent as AgentSessionEvent } from "@earendil-works/pi-agent-core";
import type {
  AssistantMessage,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import {
  AgentEventKinds,
  type AgentDomainEvent,
  type AgentEventSink,
} from "../Events/AgentEvent.js";
import { emitAgentEvent } from "../Events/AgentEvent.js";
import { AgentLoopEventFactory } from "../Loop/AgentLoopEventFactory.js";
import { clampField, type StepTrace } from "../Runtime/AgentStepTrace.js";
import {
  type AgentToolResultPresentation,
  type ExecutedToolCallResult,
} from "../Types/ToolRuntimeTypes.js";
import { projectAgentToolResultPresentation } from "../ToolRuntime/AgentToolResultPresentation.js";
import type { AgentOpenAiTranscriptMessage } from "../Conversation/AgentOpenAiTranscript.js";
import { readPiProxyToolCallBatchId } from "../PiProxy/AgentPiProxyRuntimeContext.js";
import type { AgentPiToolDetails } from "./AgentPiTypes.js";
import { projectPiSessionTraceEvent } from "./AgentPiTraceProjector.js";

export interface AgentPiRunCollectorOptions {
  requestId: string;
  step: number;
  onEvent?: AgentEventSink;
  streamModelDeltas?: boolean;
  piProxyRuntimeContextId?: string;
}

export interface AgentPiRunProjection {
  traces: StepTrace[];
  executedTools: ExecutedToolCallResult[];
  openAiMessages: AgentOpenAiTranscriptMessage[];
}

interface ActiveToolTrace {
  seq: number;
  toolName: string;
  callId: string;
  args: unknown;
}

type ProjectablePiEvent =
  | Extract<AgentSessionEvent, { type: "tool_execution_start" }>
  | Extract<AgentSessionEvent, { type: "tool_execution_end" }>
  | Extract<AgentSessionEvent, { type: "message_update" }>;

type PiEventProjector = (
  event: ProjectablePiEvent,
) => readonly AgentDomainEvent[];

export class AgentPiRunCollector {
  private readonly eventFactory = new AgentLoopEventFactory();
  private readonly projectors: Partial<Record<AgentSessionEvent["type"], PiEventProjector>> = {
    tool_execution_start: (event) => [
      this.toolExecutionStarted(event as Extract<ProjectablePiEvent, { type: "tool_execution_start" }>),
    ],
    tool_execution_end: (event) =>
      this.toolExecutionEnded(event as Extract<ProjectablePiEvent, { type: "tool_execution_end" }>),
    message_update: (event) => {
      const projected = this.messageUpdated(event as Extract<ProjectablePiEvent, { type: "message_update" }>);
      return projected ? [projected] : [];
    },
  };
  private readonly traces: StepTrace[] = [];
  private readonly activeToolTraces = new Map<string, ActiveToolTrace>();
  private readonly executedTools: ExecutedToolCallResult[] = [];
  private readonly openAiMessages: AgentOpenAiTranscriptMessage[] = [];
  private pending = Promise.resolve();
  private textDelta = "";

  constructor(private readonly options: AgentPiRunCollectorOptions) {}

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
      openAiMessages: [...this.openAiMessages],
    };
  }

  private async projectEvent(event: AgentSessionEvent): Promise<void> {
    if (event.type !== "message_update") {
      await this.emit(projectPiSessionTraceEvent({
        requestId: this.options.requestId,
        step: this.options.step,
        event,
      }));
    }

    if (event.type === "turn_end") {
      this.recordOpenAiTurn(event);
    }

    const projected = this.projectors[event.type]?.(event as ProjectablePiEvent) ?? [];
    for (const event of projected) {
      await this.emit(event);
    }
  }

  private toolExecutionStarted(
    event: Extract<AgentSessionEvent, { type: "tool_execution_start" }>,
  ): AgentDomainEvent {
    const seq = this.traces.length + this.activeToolTraces.size;
    this.activeToolTraces.set(event.toolCallId, {
      seq,
      toolName: event.toolName,
      callId: event.toolCallId,
      args: event.args,
    });
    return this.eventFactory.toolCallStarted(
      this.options.requestId,
      this.options.step,
      seq,
      event.toolName,
      event.toolCallId,
      { batchId: this.batchIdFor(event.toolCallId) },
    );
  }

  private toolExecutionEnded(
    event: Extract<AgentSessionEvent, { type: "tool_execution_end" }>,
  ): readonly AgentDomainEvent[] {
    const active = this.activeToolTraces.get(event.toolCallId) ?? {
      seq: this.traces.length,
      toolName: event.toolName,
      callId: event.toolCallId,
      args: undefined,
    };
    this.activeToolTraces.delete(event.toolCallId);

    const executed = readExecutedToolResult(event.result);
    if (executed) {
      this.executedTools.push(executed);
    }
    const trace = this.buildToolTrace(active, event, executed);
    this.traces.push(trace);

    const lifecycle = event.isError
      ? this.eventFactory.toolCallFailed(
          this.options.requestId,
          this.options.step,
          active.seq,
          event.toolName,
          event.toolCallId,
          readToolErrorMessage(event.result),
          undefined,
          { batchId: this.batchIdFor(event.toolCallId) },
        )
      : this.eventFactory.toolCallCompleted(
          this.options.requestId,
          this.options.step,
          active.seq,
          event.toolName,
          event.toolCallId,
          readToolPresentation(event.result),
          { batchId: this.batchIdFor(event.toolCallId) },
        );
    return [
      lifecycle,
      this.eventFactory.toolCallResultDetail(
        this.options.requestId,
        this.options.step,
        active.seq,
        event.toolName,
        event.toolCallId,
        executed ?? event.result,
        { batchId: this.batchIdFor(event.toolCallId) },
      ),
    ];
  }

  private messageUpdated(
    event: Extract<AgentSessionEvent, { type: "message_update" }>,
  ): AgentDomainEvent | undefined {
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
    event: Extract<AgentSessionEvent, { type: "tool_execution_end" }>,
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
      toolArgs: clampField(executed?.arguments ?? active.args),
      toolPreview: readToolPresentation(event.result)?.headline,
      toolPresentation: readToolPresentation(event.result),
      toolResult: clampField(executed?.result ?? event.result),
      toolErrorMessage: event.isError ? readToolErrorMessage(event.result) : undefined,
    };
  }

  private batchIdFor(callId: string): string | undefined {
    return readPiProxyToolCallBatchId(this.options.piProxyRuntimeContextId, callId);
  }

  private async emit(event: AgentDomainEvent): Promise<void> {
    await emitAgentEvent(this.options.onEvent, event);
  }

  private recordOpenAiTurn(event: Extract<AgentSessionEvent, { type: "turn_end" }>): void {
    const assistant = projectOpenAiAssistantMessage(event.message);
    if (assistant) {
      this.openAiMessages.push(assistant);
    }
    for (const result of event.toolResults) {
      this.openAiMessages.push(projectOpenAiToolResultMessage(result));
    }
  }
}

function projectOpenAiAssistantMessage(message: unknown): AgentOpenAiTranscriptMessage | undefined {
  const record = readRecord(message) as AssistantMessage | undefined;
  if (!record || record.role !== "assistant" || !Array.isArray(record.content)) {
    return undefined;
  }

  const text = record.content.flatMap((entry) =>
    entry.type === "text" ? [entry.text] : []).join("");
  const toolCalls = record.content.flatMap((entry) =>
    entry.type === "toolCall"
      ? [{
          id: entry.id,
          type: "function" as const,
          function: {
            name: entry.name,
            arguments: JSON.stringify(entry.arguments ?? {}),
          },
        }]
      : []);

  return {
    role: "assistant",
    content: text.length > 0 ? text : null,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };
}

function projectOpenAiToolResultMessage(
  result: ToolResultMessage,
): AgentOpenAiTranscriptMessage {
  return {
    role: "tool",
    tool_call_id: result.toolCallId,
    content: readToolResultContent(result),
  };
}

function readToolResultContent(result: ToolResultMessage): string {
  const text = result.content
    .flatMap((entry) => entry.type === "text" ? [entry.text] : [])
    .join("");
  if (text.trim().length > 0) {
    return text;
  }

  return JSON.stringify({
    type: "senera.tool_observation.v1",
    tool_name: result.toolName,
    status: result.isError ? "failure" : "success",
    content: result.content,
  });
}

function readExecutedToolResult(value: unknown): ExecutedToolCallResult | undefined {
  const details = readToolDetails(value);
  return details?.senera.executed;
}

function readToolDetails(value: unknown): AgentPiToolDetails | undefined {
  const details = readRecord(value)?.details;
  return isAgentPiToolDetails(details) ? details : undefined;
}

function isAgentPiToolDetails(value: unknown): value is AgentPiToolDetails {
  return Boolean(readRecord(readRecord(value)?.senera));
}

function readToolPresentation(value: unknown): AgentToolResultPresentation | undefined {
  const executed = readExecutedToolResult(value);
  return executed?.presentation ?? (executed ? projectAgentToolResultPresentation(executed) : undefined);
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
    ? content.flatMap((entry) => {
        const item = readRecord(entry);
        return item?.type === "text" && typeof item.text === "string" ? [item.text] : [];
      }).join("")
    : "";
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
