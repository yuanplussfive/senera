import type { AgentEventEnvelope } from "../Events/AgentEvent.js";
import { AgentEventKinds } from "../Events/AgentEvent.js";
import { AgentLogger } from "./AgentLogger.js";

export interface AgentServerEventLoggerOptions {
  logger: AgentLogger;
  detail?: "compact" | "verbose";
}

const HiddenCompactEvents = new Set<string>([
  AgentEventKinds.ModelDelta,
  AgentEventKinds.ToolCallResultDetail,
]);

const FullPayloadEvents = new Set<string>([
  AgentEventKinds.PiTrace,
  AgentEventKinds.RunFailed,
  AgentEventKinds.RequestInvalid,
  AgentEventKinds.ConfigFailed,
  AgentEventKinds.ToolCallFailed,
]);

export class AgentServerEventLogger {
  constructor(private readonly options: AgentServerEventLoggerOptions) {}

  event(envelope: AgentEventEnvelope<string, unknown>): void {
    if (this.shouldHide(envelope)) {
      return;
    }

    this.options.logger.event(envelope);

    if (this.shouldPrintPayload(envelope)) {
      this.options.logger.tree(`${envelope.kind} payload`, envelope.data);
    }
  }

  private shouldHide(envelope: AgentEventEnvelope<string, unknown>): boolean {
    return this.options.detail !== "verbose" && HiddenCompactEvents.has(envelope.kind);
  }

  private shouldPrintPayload(envelope: AgentEventEnvelope<string, unknown>): boolean {
    return this.options.detail === "verbose" && FullPayloadEvents.has(envelope.kind);
  }
}
