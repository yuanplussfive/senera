import { createOpaqueId } from "../Core/AgentIds.js";
import { serializeError } from "../Diagnostics/AgentErrorSerializer.js";
import {
  AgentEventKinds,
  emitAgentEvent,
  type AgentDomainEvent,
  type AgentEventSink,
} from "../Events/AgentEvent.js";
import type { ResolvedAgentLoopConfig } from "../Types/AgentConfigTypes.js";
import { createPiTraceEvent } from "./AgentPiTraceProjector.js";
import type {
  AgentPiRuntimeService,
  AgentPiSessionResult,
} from "./AgentPiSubstrate.js";
import { runAgentPiGuardedPhase } from "./AgentPiTurnGuard.js";

export interface AgentPiSessionBootstrapRuntime {
  agentLoopConfig: Pick<ResolvedAgentLoopConfig, "PiSessionCreateTimeoutMs">;
  services: {
    pi: AgentPiRuntimeService;
  };
}

export interface AgentPiSessionBootstrapServiceOptions {
  runtime: (modelProviderId?: string) => AgentPiSessionBootstrapRuntime;
}

export interface AgentPiSessionBootstrapRequest {
  sessionId: string;
  modelProviderId?: string;
  onEvent?: AgentEventSink;
}

export interface AgentPiSessionBootstrapPort {
  bootstrap(request: AgentPiSessionBootstrapRequest): Promise<void>;
}

const PiSessionBootstrapTraceEvents = {
  Started: "session.bootstrap.started",
  Completed: "session.bootstrap.completed",
  Failed: "session.bootstrap.failed",
} as const;

const PiSessionBootstrapPhase = "session.bootstrap";

export class AgentPiSessionBootstrapService implements AgentPiSessionBootstrapPort {
  constructor(private readonly options: AgentPiSessionBootstrapServiceOptions) {}

  async bootstrap(request: AgentPiSessionBootstrapRequest): Promise<void> {
    const runtime = this.options.runtime(request.modelProviderId);
    const requestId = createOpaqueId("pi_bootstrap");
    const step = 0;
    let createSessionPromise: Promise<AgentPiSessionResult> | undefined;

    await this.emitTrace(request, requestId, step, PiSessionBootstrapTraceEvents.Started, {
      sessionId: request.sessionId,
      modelProviderId: request.modelProviderId,
      timeoutMs: runtime.agentLoopConfig.PiSessionCreateTimeoutMs,
    });

    try {
      const result = await runAgentPiGuardedPhase({
        phase: PiSessionBootstrapPhase,
        timeoutMs: runtime.agentLoopConfig.PiSessionCreateTimeoutMs,
        run: () => {
          createSessionPromise = runtime.services.pi.createSession({
            sessionId: request.sessionId,
            requestId,
            step,
            visibleToolNames: [],
            onEvent: (event) => emitAgentEvent(
              request.onEvent,
              stripPersistentSessionContext(event),
            ),
          });
          return createSessionPromise;
        },
      });

      result.session.dispose();
      await this.emitTrace(request, requestId, step, PiSessionBootstrapTraceEvents.Completed, {
        sessionId: request.sessionId,
        piSessionId: result.piSessionId,
        historyMigrationRequired: result.historyMigrationRequired,
        activeTools: result.session.getActiveToolNames(),
      });
    } catch (error) {
      void createSessionPromise?.then(
        (lateSession) => lateSession.session.dispose(),
        () => undefined,
      );
      await this.emitTrace(request, requestId, step, PiSessionBootstrapTraceEvents.Failed, {
        sessionId: request.sessionId,
        error: serializeError(error),
      });
    }
  }

  private async emitTrace(
    request: AgentPiSessionBootstrapRequest,
    requestId: string,
    step: number,
    eventType: string,
    payload: unknown,
  ): Promise<void> {
    await emitAgentEvent(request.onEvent, createPiTraceEvent({
      requestId,
      step,
      source: "substrate",
      eventType,
      payload,
    }));
  }
}

function stripPersistentSessionContext(event: AgentDomainEvent): AgentDomainEvent {
  if (event.kind !== AgentEventKinds.PiTrace) {
    return event;
  }

  const context = { ...event.context };
  delete context.sessionId;
  return {
    ...event,
    context,
  } as AgentDomainEvent;
}
