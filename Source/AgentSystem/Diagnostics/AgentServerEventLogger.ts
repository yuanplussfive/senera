import type { AgentEventEnvelope } from "../Events/AgentEvent.js";
import { AgentEventKinds } from "../Events/AgentEvent.js";
import { type AgentLogger } from "./AgentLogger.js";

export interface AgentServerEventLoggerOptions {
  logger: AgentLogger;
  detail?: "compact" | "verbose";
  persistHiddenEvents?: boolean | (() => boolean);
}

const HiddenCompactEvents = new Set<string>([
  AgentEventKinds.ModelDelta,
  AgentEventKinds.ModelThinkingDelta,
  AgentEventKinds.ModelThinkingCompleted,
  AgentEventKinds.ToolCallResultDetail,
]);

const FullPayloadEvents = new Set<string>([
  AgentEventKinds.RunFailed,
  AgentEventKinds.RequestInvalid,
  AgentEventKinds.ConfigFailed,
  AgentEventKinds.ToolCallFailed,
]);

export class AgentServerEventLogger {
  constructor(private readonly options: AgentServerEventLoggerOptions) {}

  event(envelope: AgentEventEnvelope<string, unknown>): void {
    const hidden = this.shouldHide(envelope);
    const persistHiddenEvents =
      typeof this.options.persistHiddenEvents === "function"
        ? this.options.persistHiddenEvents()
        : this.options.persistHiddenEvents === true;
    this.options.logger.event(envelope, {
      display: !hidden,
      persist: !hidden || persistHiddenEvents,
    });

    if (!hidden && this.shouldPrintPayload(envelope)) {
      this.options.logger.tree(`${envelope.kind} payload`, envelope.data);
    }
  }

  private shouldHide(envelope: AgentEventEnvelope<string, unknown>): boolean {
    if (envelope.kind === AgentEventKinds.McpServerSnapshot) return true;
    return this.options.detail !== "verbose" && HiddenCompactEvents.has(envelope.kind);
  }

  private shouldPrintPayload(envelope: AgentEventEnvelope<string, unknown>): boolean {
    return this.options.detail === "verbose" && FullPayloadEvents.has(envelope.kind);
  }
}
