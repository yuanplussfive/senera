import type { AgentEventScope, AgentEventSink } from "../Events/AgentEvent.js";
import type { AgentModelUsageValue } from "../ModelEndpoints/AgentModelUsage.js";
import type { AgentExecutionApprovalMode } from "../Safety/AgentExecutionApprovalMode.js";
import type { AgentPinnedSkillReference } from "../Skills/AgentSkillActivation.js";
import type { AgentSessionOwnership } from "../ModelEndpoints/AgentModelMetadata.js";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";

export interface AgentSystemPromptLayer {
  readonly mode: "append" | "replace";
  readonly content: string;
}

export const AgentRunContextModes = {
  Fresh: "fresh",
  Fork: "fork",
} as const;

export type AgentRunContextMode = (typeof AgentRunContextModes)[keyof typeof AgentRunContextModes];

export interface AgentRunDispatchRequest {
  readonly sessionId: string;
  readonly requestId: string;
  readonly input: string;
  readonly approvalMode: AgentExecutionApprovalMode;
  readonly modelProviderId?: string;
  readonly systemPromptLayer?: AgentSystemPromptLayer;
  readonly allowedToolNames?: readonly string[];
  readonly pinnedSkills?: readonly AgentPinnedSkillReference[];
  readonly thinkingLevel?: ModelThinkingLevel;
  readonly inheritProjectContext?: boolean;
  /** Ownership written when the dispatcher creates the child session. */
  readonly sessionOwnership?: AgentSessionOwnership;
  readonly scope?: AgentEventScope;
  readonly parent?: {
    readonly sessionId: string;
    readonly requestId: string;
  };
  readonly contextMode: AgentRunContextMode;
  readonly onEvent?: AgentEventSink;
  readonly signal?: AbortSignal;
}

export interface AgentRunDispatchResult {
  readonly sessionId: string;
  readonly requestId: string;
  readonly finalAnswer: string;
  /** A child may have useful text before Pi publishes a terminal answer. */
  readonly completion?: "complete" | "partial";
  /** Evidence and artifact references observed from completed tool calls. */
  readonly evidenceRefs?: readonly string[];
  readonly usage?: AgentModelUsageValue;
}

export interface AgentRunDispatchPort {
  dispatch(request: AgentRunDispatchRequest): Promise<AgentRunDispatchResult>;
  requestFinalAnswer(sessionId: string, instruction: string): Promise<boolean>;
  /**
   * Admit cancellation to the Session control plane without waiting for the
   * model, provider stream, or run-owned resources to settle.
   */
  requestCancellation(sessionId: string, onEvent?: AgentEventSink): Promise<boolean>;
  /** Wait for a previously requested cancellation to settle. */
  cancel(sessionId: string, onEvent?: AgentEventSink): Promise<boolean>;
  /** Queue a supervisor steering message without taking a parent Tool resource lease. */
  steer?(sessionId: string, input: string, onEvent?: AgentEventSink): Promise<boolean>;
  /** Queue a follow-up that runs after the child's current assignment settles. */
  followUp?(sessionId: string, input: string, onEvent?: AgentEventSink, requestId?: string): Promise<boolean>;
  /** Ask the active Pi turn to stop investigating and consolidate its current evidence. */
  interrupt?(sessionId: string, instruction: string): Promise<boolean>;
}

export class AgentRunDispatchGateway implements AgentRunDispatchPort {
  private delegate?: AgentRunDispatchPort;

  bind(delegate: AgentRunDispatchPort): () => void {
    if (this.delegate) throw new Error("Agent run dispatch gateway is already bound.");
    this.delegate = delegate;
    return () => {
      if (this.delegate === delegate) this.delegate = undefined;
    };
  }

  dispatch(request: AgentRunDispatchRequest): Promise<AgentRunDispatchResult> {
    return this.requireDelegate().dispatch(request);
  }

  requestFinalAnswer(sessionId: string, instruction: string): Promise<boolean> {
    return this.requireDelegate().requestFinalAnswer(sessionId, instruction);
  }

  requestCancellation(sessionId: string, onEvent?: AgentEventSink): Promise<boolean> {
    return this.requireDelegate().requestCancellation(sessionId, onEvent);
  }

  cancel(sessionId: string, onEvent?: AgentEventSink): Promise<boolean> {
    return this.requireDelegate().cancel(sessionId, onEvent);
  }

  steer(sessionId: string, input: string, onEvent?: AgentEventSink): Promise<boolean> {
    return this.requireDelegate().steer?.(sessionId, input, onEvent) ?? Promise.resolve(false);
  }

  followUp(sessionId: string, input: string, onEvent?: AgentEventSink, requestId?: string): Promise<boolean> {
    return this.requireDelegate().followUp?.(sessionId, input, onEvent, requestId) ?? Promise.resolve(false);
  }

  interrupt(sessionId: string, instruction: string): Promise<boolean> {
    return this.requireDelegate().interrupt?.(sessionId, instruction) ?? Promise.resolve(false);
  }

  private requireDelegate(): AgentRunDispatchPort {
    if (!this.delegate) throw new Error("Agent run dispatch gateway is not bound to a session runtime.");
    return this.delegate;
  }
}
