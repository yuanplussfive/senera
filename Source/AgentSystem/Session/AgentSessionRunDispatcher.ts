import { AgentCancellationError, readAbortMessage, throwIfAborted } from "../Core/AgentCancellation.js";
import { AgentEventKinds, withEventContext, type AgentDomainEvent } from "../Events/AgentEvent.js";
import type { AgentModelUsageValue } from "../ModelEndpoints/AgentModelUsage.js";
import {
  AgentRunContextModes,
  type AgentRunDispatchPort,
  type AgentRunDispatchRequest,
  type AgentRunDispatchResult,
} from "../Orchestration/AgentRunDispatchPort.js";
import { AgentSessionMessageDispositions } from "./AgentSessionMessageDisposition.js";
import type { AgentSessionManager } from "./AgentSessionManager.js";

export class AgentSessionRunDispatcher implements AgentRunDispatchPort {
  constructor(
    private readonly sessions: Pick<
      AgentSessionManager,
      | "forkSession"
      | "submitMessage"
      | "requestActiveRunCancellation"
      | "settleActiveRunCancellation"
      | "requestActiveRunFinalAnswer"
      | "steerActiveRun"
      | "followUpActiveRun"
      | "interruptActiveRun"
    >,
  ) {}

  async dispatch(request: AgentRunDispatchRequest): Promise<AgentRunDispatchResult> {
    throwIfAborted(request.signal);
    const observation: DispatchObservation = { evidenceRefs: new Set<string>() };
    const onEvent = async (event: AgentDomainEvent): Promise<void> => {
      const contextual = request.scope ? withEventContext(event, { scope: request.scope }) : event;
      observeDispatchEvent(observation, contextual);
      await request.onEvent?.(contextual);
    };

    if (request.contextMode === AgentRunContextModes.Fork) {
      if (!request.parent) throw new Error("Forked Agent runs require a parent session and request.");
      await this.sessions.forkSession({
        sourceSessionId: request.parent.sessionId,
        sessionId: request.sessionId,
        throughRequestId: request.parent.requestId,
        ownership: request.sessionOwnership,
        onEvent,
      });
    }

    throwIfAborted(request.signal);
    let cancellation: Promise<boolean> | undefined;
    const abort = (): void => {
      cancellation ??= this.sessions.requestActiveRunCancellation({ sessionId: request.sessionId, onEvent });
      // Admission is intentionally fire-and-forget here. The dispatch promise
      // still settles at the same boundary as the Session turn, so orchestration
      // cannot persist a terminal child state while Pi is still running.
      void cancellation.catch(() => undefined);
    };
    const submission = this.sessions.submitMessage({
      sessionId: request.sessionId,
      requestId: request.requestId,
      modelProviderId: request.modelProviderId,
      input: request.input,
      approvalMode: request.approvalMode,
      disposition:
        request.contextMode === AgentRunContextModes.Fresh
          ? AgentSessionMessageDispositions.CreateIfMissing
          : undefined,
      systemPromptLayer: request.systemPromptLayer,
      allowedToolNames: request.allowedToolNames,
      pinnedSkills: request.pinnedSkills,
      thinkingLevel: request.thinkingLevel,
      inheritProjectContext: request.inheritProjectContext,
      sessionOwnership: request.sessionOwnership,
      onEvent,
    });
    await waitForAbortOrCompletion(submission, request.signal, abort);

    if (request.signal?.aborted) {
      throw new AgentCancellationError(readAbortMessage(request.signal));
    }
    if (observation.finalAnswer) {
      return {
        sessionId: request.sessionId,
        requestId: request.requestId,
        finalAnswer: observation.finalAnswer,
        completion: "complete",
        evidenceRefs: [...observation.evidenceRefs],
        usage: observation.usage,
      };
    }
    if (observation.latestAssistantText || observation.latestModelText) {
      return {
        sessionId: request.sessionId,
        requestId: request.requestId,
        finalAnswer: observation.latestAssistantText ?? observation.latestModelText!,
        completion: "partial",
        evidenceRefs: [...observation.evidenceRefs],
        usage: observation.usage,
      };
    }
    if (observation.failure) throw new Error(observation.failure);
    if (observation.cancelled) throw new AgentCancellationError("Agent child run was cancelled.");
    throw new Error("Agent child run completed without a terminal answer or checkpoint.");
  }

  requestFinalAnswer(sessionId: string, instruction: string): Promise<boolean> {
    return this.sessions.requestActiveRunFinalAnswer({ sessionId, instruction });
  }

  requestCancellation(sessionId: string, onEvent?: AgentRunDispatchRequest["onEvent"]): Promise<boolean> {
    return this.sessions.requestActiveRunCancellation({ sessionId, onEvent });
  }

  cancel(sessionId: string, onEvent?: AgentRunDispatchRequest["onEvent"]): Promise<boolean> {
    return this.sessions.settleActiveRunCancellation({ sessionId, onEvent });
  }

  steer(sessionId: string, input: string, onEvent?: AgentRunDispatchRequest["onEvent"]): Promise<boolean> {
    return this.sessions.steerActiveRun({ sessionId, input, onEvent });
  }

  followUp(
    sessionId: string,
    input: string,
    onEvent?: AgentRunDispatchRequest["onEvent"],
    requestId?: string,
  ): Promise<boolean> {
    return this.sessions.followUpActiveRun({ sessionId, input, onEvent, requestId });
  }

  interrupt(sessionId: string, instruction: string): Promise<boolean> {
    return this.sessions.interruptActiveRun({ sessionId, instruction });
  }
}

function waitForAbortOrCompletion(
  completion: Promise<unknown>,
  signal: AbortSignal | undefined,
  onAbort: () => void,
): Promise<void> {
  const turn = completion.then(() => undefined);
  if (!signal) return turn;
  const abort = (): void => onAbort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  return turn.finally(() => signal.removeEventListener("abort", abort));
}

interface DispatchObservation {
  finalAnswer?: string;
  latestAssistantText?: string;
  latestModelText?: string;
  failure?: string;
  cancelled?: boolean;
  evidenceRefs: Set<string>;
  usage?: AgentModelUsageValue;
}

function observeDispatchEvent(observation: DispatchObservation, event: AgentDomainEvent): void {
  switch (event.kind) {
    case AgentEventKinds.AssistantMessageCreated:
      if (event.data.content.trim()) observation.latestAssistantText = event.data.content;
      if (event.data.kind === "final_answer" && event.data.terminal) observation.finalAnswer = event.data.content;
      return;
    case AgentEventKinds.ModelCompleted:
      if (event.data.text.trim()) observation.latestModelText = event.data.text;
      if (event.data.usage) observation.usage = event.data.usage;
      return;
    case AgentEventKinds.ToolCallCompleted:
    case AgentEventKinds.ToolCallResultDetail: {
      const presentation = event.data.presentation;
      if (presentation?.artifactUri) observation.evidenceRefs.add(presentation.artifactUri);
      for (const evidence of presentation?.evidence ?? []) {
        if (evidence.evidenceUri) observation.evidenceRefs.add(evidence.evidenceUri);
      }
      return;
    }
    case AgentEventKinds.RunFailed:
      observation.failure = event.data.message;
      return;
    case AgentEventKinds.RunCancelled:
      observation.cancelled = true;
      return;
    default:
      return;
  }
}
