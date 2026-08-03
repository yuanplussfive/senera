import type { AgentEvent, AgentMessage, AgentState } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import type { AgentSession as CodingAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { AgentCancellationError } from "../Core/AgentCancellation.js";
import { toError } from "../Core/AgentErrors.js";
import { AgentPiSessionCustomEntryTypes } from "./AgentPiSessionEntries.js";
import { isAgentPiConversationHistoryEmpty } from "./AgentPiSessionHistoryPolicy.js";
import type { AgentPiSession, AgentPiSessionEventListener } from "./AgentPiRuntimeTypes.js";

const CoreAgentEventTypes = new Set<AgentEvent["type"]>([
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
]);

export class AgentPiCodingAgentSession implements AgentPiSession {
  private released = false;
  private abortPromise: Promise<void> | undefined;
  private eventDelivery = Promise.resolve();
  private eventDeliveryError: Error | undefined;

  constructor(
    private readonly session: CodingAgentSession,
    private readonly sessionManager: SessionManager,
    private readonly release: () => void,
  ) {}

  get state(): AgentState {
    return this.session.state;
  }

  get model(): AgentState["model"] {
    return this.session.state.model;
  }

  setHistory(messages: readonly AgentMessage[]): void {
    if (!isAgentPiConversationHistoryEmpty(this.sessionManager)) {
      throw new Error("Pi Coding Agent history can only be imported into an empty session.");
    }

    for (const message of messages) appendSessionMessage(this.sessionManager, message);
    this.session.agent.state.messages = [...messages];
  }

  async prompt(text: string, options?: { expandPromptTemplates?: boolean; source?: string }): Promise<void> {
    let failure: Error | undefined;
    try {
      await this.session.prompt(text, {
        expandPromptTemplates: options?.expandPromptTemplates,
        source: options?.source === "extension" ? "extension" : "interactive",
      });
      await this.session.waitForIdle();
    } catch (error) {
      failure = toError(error);
    }
    try {
      await this.drainEvents();
    } catch (error) {
      failure ??= toError(error);
    }
    if (failure) throw failure;
    throwIfAssistantFailed(lastAssistantMessage(this.session.messages));
  }

  steer(text: string): Promise<void> {
    return this.session.steer(text);
  }

  followUp(text: string): Promise<void> {
    return this.session.followUp(text);
  }

  markTurnBoundary(requestId: string): Promise<string> {
    return Promise.resolve(
      this.sessionManager.appendCustomEntry(AgentPiSessionCustomEntryTypes.TurnBoundary, { requestId }),
    );
  }

  subscribe(listener: AgentPiSessionEventListener): () => void {
    return this.session.subscribe((event) => {
      if (CoreAgentEventTypes.has(event.type as AgentEvent["type"])) {
        this.eventDelivery = this.eventDelivery
          .then(() => listener(event as AgentEvent))
          .catch((error: unknown) => {
            this.eventDeliveryError ??= toError(error);
          });
      }
    });
  }

  abort(): Promise<void> {
    return (this.abortPromise ??= this.session.abort());
  }

  dispose(): void {
    if (this.released) return;
    this.released = true;
    this.release();
  }

  getLastAssistantText(): string | undefined {
    const assistant = lastAssistantMessage(this.session.messages);
    return assistant ? assistantText(assistant) : undefined;
  }

  getActiveToolNames(): string[] {
    return this.session.getActiveToolNames();
  }

  private async drainEvents(): Promise<void> {
    await this.eventDelivery;
    const error = this.eventDeliveryError;
    this.eventDeliveryError = undefined;
    if (error) throw error;
  }
}

function appendSessionMessage(sessionManager: SessionManager, message: AgentMessage): void {
  if (message.role === "custom") {
    sessionManager.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
    return;
  }

  if (isLanguageModelMessage(message)) {
    sessionManager.appendMessage(message);
    return;
  }

  throw new Error(`Unsupported Pi history message role: ${String(message.role)}`);
}

function isLanguageModelMessage(message: AgentMessage): message is Message {
  return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
}

function lastAssistantMessage(messages: readonly AgentMessage[]): AssistantMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant") return message;
  }
  return undefined;
}

function assistantText(message: AssistantMessage): string {
  return message.content
    .flatMap((entry) => (entry.type === "text" ? [entry.text] : []))
    .join("")
    .trim();
}

function throwIfAssistantFailed(message: AssistantMessage | undefined): void {
  if (!message) return;
  if (message.stopReason === "aborted") {
    throw new AgentCancellationError(message.errorMessage ?? "Pi provider request was aborted.");
  }
  if (message.stopReason === "error") {
    throw new Error(message.errorMessage ?? "Pi provider returned an error.");
  }
}
