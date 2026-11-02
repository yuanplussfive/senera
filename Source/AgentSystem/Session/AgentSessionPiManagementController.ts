import type { AgentDomainEvent, AgentEventSink } from "../Events/AgentEvent.js";
import { AgentEventKinds, emitAgentEvent } from "../Events/AgentEvent.js";
import { projectAgentMessage } from "../I18n/AgentMessageProjection.js";
import { resolveAgentPiSessionLifecycle } from "../Pi/AgentPiSessionLifecycleMetadata.js";
import type { AgentPiSessionManagementPort } from "../Pi/AgentPiSessionMutationService.js";
import type { AgentSessionEventFactory } from "./AgentSessionEventFactory.js";
import type { AgentSessionOperation } from "./AgentSessionOperation.js";
import type { AgentSessionStore } from "./AgentSessionStore.js";

export interface AgentSessionPiManagementControllerOptions {
  readonly store: AgentSessionStore;
  readonly service?: AgentPiSessionManagementPort;
  readonly events: AgentSessionEventFactory;
  readonly ready: () => Promise<void>;
}

export class AgentSessionPiManagementController {
  constructor(private readonly options: AgentSessionPiManagementControllerOptions) {}

  async run<TResult>(
    request: { sessionId: string; onEvent?: AgentEventSink },
    operation: AgentSessionOperation,
    execute: (
      service: AgentPiSessionManagementPort,
      modelProviderId: string | undefined,
    ) => Promise<TResult | undefined>,
    projectEvent: (result: TResult) => AgentDomainEvent,
  ): Promise<void> {
    await this.options.ready();
    const lookup = this.options.store.get(request.sessionId);
    if (lookup.kind === "missing") {
      await emitAgentEvent(request.onEvent, this.options.events.notFound(request.sessionId, operation));
      return;
    }

    const lifecycle = resolveAgentPiSessionLifecycle(lookup.session.metadata);
    const service = this.options.service;
    if (!lifecycle.initialized || !service) {
      await this.emitUnavailable(request, operation);
      return;
    }
    const result = await execute(service, lifecycle.modelProviderId);
    if (result === undefined) {
      await this.emitUnavailable(request, operation);
      return;
    }
    await emitAgentEvent(request.onEvent, projectEvent(result));
  }

  emitUnavailable(
    request: { sessionId: string; onEvent?: AgentEventSink },
    operation: AgentSessionOperation,
  ): Promise<void> {
    return emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.RequestInvalid,
      context: { sessionId: request.sessionId },
      data: {
        code: "session_pi_unavailable",
        ...projectAgentMessage("session.piUnavailable", { operation }),
      },
    });
  }
}
