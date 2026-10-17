import type { AgentMessage, AgentState } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ImageContent } from "@earendil-works/pi-ai";
import { type AgentSession as CodingAgentSession, type SessionManager } from "@earendil-works/pi-coding-agent";
import { AgentCancellationError } from "../Core/AgentCancellation.js";
import { toError } from "../Core/AgentErrors.js";
import { AgentPiSessionCustomEntryTypes } from "./AgentPiSessionEntries.js";
import type { AgentPiSession, AgentPiSessionEventListener } from "./AgentPiRuntimeTypes.js";
import type { AgentPiMutableSessionFrame } from "./AgentPiCodingAgentSessionFrame.js";
import { mergeAgentPiTurnContext, projectAgentPiTurnContext } from "./AgentPiTurnContextMessage.js";

export class AgentPiCodingAgentSession implements AgentPiSession {
  private released = false;
  private abortPromise: Promise<void> | undefined;
  private eventDelivery = Promise.resolve();
  private eventDeliveryError: Error | undefined;

  constructor(
    private readonly session: CodingAgentSession,
    private readonly sessionManager: SessionManager,
    private readonly frame: AgentPiMutableSessionFrame,
    private readonly release: () => void,
  ) {}

  get state(): AgentState {
    return this.session.state;
  }

  get model(): AgentState["model"] {
    return this.session.state.model;
  }

  async prompt(
    text: string,
    options?: { expandPromptTemplates?: boolean; source?: string; images?: readonly ImageContent[] },
  ): Promise<void> {
    let failure: Error | undefined;
    try {
      // Keep the in-memory Pi transcript aligned with the durable projection
      // after compaction, rewind, or recovery before appending this prompt.
      this.session.refreshContext();
      const frame = this.frame.snapshot();
      const turnContext = projectAgentPiTurnContext({
        turnContext: frame.turnContext,
        skills: this.frame.skillSnapshot(),
        selectedPromptTemplates: frame.selectedPromptTemplates,
      });
      const prompt = mergeAgentPiTurnContext(text, turnContext);
      await this.session.prompt(prompt, {
        expandPromptTemplates: options?.expandPromptTemplates,
        source: options?.source === "extension" ? "extension" : "interactive",
        ...(options?.images && options.images.length > 0 ? { images: [...options.images] } : {}),
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

  prepareContinuation(sourceRequestId?: string): void {
    this.session.refreshContext();
    if (this.session.agent.hasQueuedMessages()) return;

    const branch = this.sessionManager.getBranch();
    const sourceEntryId = sourceRequestId ? readContinuableEntryIdForRequest(branch, sourceRequestId) : undefined;
    if (sourceEntryId) {
      this.sessionManager.branch(sourceEntryId);
      this.session.agent.state.messages = this.sessionManager.buildSessionContext().messages;
      return;
    }

    const lastMessage = this.session.agent.state.messages.at(-1);
    if (lastMessage?.role === "user" || lastMessage?.role === "toolResult") return;

    const branchEntryId = readLatestContinuableEntryId(branch);
    if (!branchEntryId) {
      throw new Error("Pi transcript has no user or tool-result message to continue from.");
    }
    this.sessionManager.branch(branchEntryId);
    this.session.agent.state.messages = this.sessionManager.buildSessionContext().messages;
  }

  async continue(): Promise<void> {
    let failure: Error | undefined;
    try {
      await this.session.agent.continue();
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

  steer(text: string, images?: readonly ImageContent[]): Promise<void> {
    return this.session.steer(text, images ? [...images] : undefined);
  }

  followUp(text: string, images?: readonly ImageContent[]): Promise<void> {
    return this.session.followUp(text, images ? [...images] : undefined);
  }

  async requestFinalAnswer(instruction: string): Promise<boolean> {
    const turnState = this.frame.snapshot().turnState;
    if (!turnState) return false;
    if (!turnState.requestWrapUp("child_deadline")) return true;
    await this.session.steer(instruction);
    return true;
  }

  markTurnBoundary(requestId: string): Promise<string> {
    return Promise.resolve(
      this.sessionManager.appendCustomEntry(AgentPiSessionCustomEntryTypes.TurnBoundary, { requestId }),
    );
  }

  subscribe(listener: AgentPiSessionEventListener): () => void {
    return this.session.subscribe((event) => {
      this.eventDelivery = this.eventDelivery
        .then(() => listener(event))
        .catch((error: unknown) => {
          this.eventDeliveryError ??= toError(error);
        });
    });
  }

  abort(): Promise<void> {
    if (this.abortPromise) return this.abortPromise;
    // Pi's session.abort() waits for idle but does not cancel its separate
    // auto-compaction or branch-summary controllers. Cancel those operations
    // first so a user stop cannot wait for an in-flight summarization request.
    this.session.abortCompaction();
    this.session.abortBranchSummary();
    const operation = this.session.abort();
    const tracked = operation.finally(() => {
      if (this.abortPromise === tracked) this.abortPromise = undefined;
    });
    this.abortPromise = tracked;
    return tracked;
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

type AgentPiSessionEntry = ReturnType<SessionManager["getBranch"]>[number];
type AgentPiCustomEntry = Extract<AgentPiSessionEntry, { type: "custom" }>;

function readContinuableEntryIdForRequest(
  entries: readonly AgentPiSessionEntry[],
  sourceRequestId: string,
): string | undefined {
  for (let boundaryIndex = entries.length - 1; boundaryIndex >= 0; boundaryIndex -= 1) {
    const boundary = entries[boundaryIndex];
    if (!isTurnBoundaryForRequest(boundary, sourceRequestId)) continue;
    let continuableEntryId: string | undefined;
    for (let index = boundaryIndex + 1; index < entries.length; index += 1) {
      const entry = entries[index];
      if (isTurnBoundaryEntry(entry)) break;
      if (entry?.type !== "message") continue;
      if (entry.message.role === "user" || entry.message.role === "toolResult") continuableEntryId = entry.id;
    }
    return continuableEntryId;
  }
  return undefined;
}

function isTurnBoundaryForRequest(entry: AgentPiSessionEntry | undefined, requestId: string): boolean {
  return isTurnBoundaryEntry(entry) && readCustomEntryRequestId(entry) === requestId;
}

function isTurnBoundaryEntry(entry: AgentPiSessionEntry | undefined): entry is AgentPiCustomEntry {
  return entry?.type === "custom" && entry.customType === AgentPiSessionCustomEntryTypes.TurnBoundary;
}

function readCustomEntryRequestId(entry: AgentPiCustomEntry): string | undefined {
  const data = entry.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const requestId = (data as { requestId?: unknown }).requestId;
  return typeof requestId === "string" && requestId.length > 0 ? requestId : undefined;
}

function readLatestContinuableEntryId(entries: readonly AgentPiSessionEntry[]): string | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== "message") continue;
    if (entry.message.role === "user" || entry.message.role === "toolResult") return entry.id;
  }
  return undefined;
}
