import type { AgentWebSocketRequestOf } from "./AgentWebSocketProtocol.js";
import type { AgentWebSocketEventSender, AgentWebSocketRequestContext } from "./AgentWebSocketTypes.js";
import { projectAgentWebSocketRequestFailure } from "./AgentWebSocketRequestFailures.js";

export class AgentWebSocketSessionRequestHandlers {
  constructor(private readonly context: AgentWebSocketRequestContext) {}

  async create(
    request: AgentWebSocketRequestOf<"session.create">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.context.sessionManager.createSession({ sessionId: request.sessionId, onEvent: sendEvent });
  }

  async message(
    request: AgentWebSocketRequestOf<"session.message">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.context.sessionManager.submitMessage({
      sessionId: request.sessionId,
      requestId: request.requestId,
      modelProviderId: request.modelProviderId,
      thinkingLevel: request.thinkingLevel,
      input: request.input,
      approvalMode: request.approvalMode,
      attachments: request.attachments,
      disposition: request.disposition,
      queueMode: request.queueMode,
      activations: request.activations,
      onEvent: sendEvent,
    });
  }

  async close(request: AgentWebSocketRequestOf<"session.close">, sendEvent: AgentWebSocketEventSender): Promise<void> {
    await this.context.sessionManager.closeSession({ sessionId: request.sessionId, onEvent: sendEvent });
  }

  async closeMany(
    request: AgentWebSocketRequestOf<"session.close_many">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    const outcomes = await this.context.sessionManager.closeSessions({
      sessionIds: request.sessionIds,
      onEvent: sendEvent,
    });
    for (const outcome of outcomes) {
      if (outcome.kind !== "failed") continue;
      await sendEvent(
        projectAgentWebSocketRequestFailure(
          { type: "session.close", sessionId: outcome.sessionId },
          outcome.error,
          this.context,
        ),
      );
    }
  }

  async cancel(
    request: AgentWebSocketRequestOf<"session.cancel">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.context.sessionManager.requestActiveRunCancellation({
      sessionId: request.sessionId,
      ...(request.requestId ? { requestId: request.requestId } : {}),
      onEvent: sendEvent,
    });
  }

  async truncateFrom(
    request: AgentWebSocketRequestOf<"session.truncate_from">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.context.sessionManager.truncateFromRequest({
      sessionId: request.sessionId,
      requestId: request.requestId,
      onEvent: sendEvent,
    });
  }

  async regenerate(
    request: AgentWebSocketRequestOf<"session.regenerate">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.context.sessionManager.regenerateFromRequest({
      sessionId: request.sessionId,
      fromRequestId: request.fromRequestId,
      requestId: request.requestId,
      modelProviderId: request.modelProviderId,
      thinkingLevel: request.thinkingLevel,
      input: request.input,
      approvalMode: request.approvalMode,
      attachments: request.attachments,
      activations: request.activations,
      onEvent: sendEvent,
    });
  }

  async retry(request: AgentWebSocketRequestOf<"session.retry">, sendEvent: AgentWebSocketEventSender): Promise<void> {
    await this.context.sessionManager.retryFailedRun({
      sessionId: request.sessionId,
      failedRequestId: request.failedRequestId,
      requestId: request.requestId,
      recoveryMode: request.recoveryMode,
      modelProviderId: request.modelProviderId,
      thinkingLevel: request.thinkingLevel,
      approvalMode: request.approvalMode,
      activations: request.activations,
      onEvent: sendEvent,
    });
  }

  async fork(request: AgentWebSocketRequestOf<"session.fork">, sendEvent: AgentWebSocketEventSender): Promise<void> {
    await this.context.sessionManager.forkSession({
      sourceSessionId: request.sourceSessionId,
      sessionId: request.sessionId,
      throughRequestId: request.throughRequestId,
      onEvent: sendEvent,
    });
  }

  async compact(
    request: AgentWebSocketRequestOf<"session.compact">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.context.sessionManager.compactSession({
      sessionId: request.sessionId,
      customInstructions: request.customInstructions,
      onEvent: sendEvent,
    });
  }

  async runtimeStatus(
    request: AgentWebSocketRequestOf<"session.runtime_status">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.context.sessionManager.emitPiSessionRuntimeStatus({
      sessionId: request.sessionId,
      onEvent: sendEvent,
    });
  }

  async export(
    request: AgentWebSocketRequestOf<"session.export">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.context.sessionManager.exportPiSession({
      sessionId: request.sessionId,
      format: request.format,
      onEvent: sendEvent,
    });
  }

  async list(sendEvent: AgentWebSocketEventSender): Promise<void> {
    await this.context.sessionManager.emitSessionListSnapshot({ onEvent: sendEvent });
  }

  async history(
    request: AgentWebSocketRequestOf<"session.history">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.context.sessionManager.replayHistory({
      sessionId: request.sessionId,
      refresh: request.refresh,
      initialWindow: request.initialWindow,
      onEvent: sendEvent,
    });
  }

  async rename(
    request: AgentWebSocketRequestOf<"session.rename">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.context.sessionManager.renameSession({
      sessionId: request.sessionId,
      title: request.title,
      onEvent: sendEvent,
    });
  }
}
