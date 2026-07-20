import { createOpaqueId } from "../Core/AgentIds.js";
import { serializeError } from "../Diagnostics/AgentErrorSerializer.js";
import { emitAgentEvent, type AgentEventSink } from "../Events/AgentEvent.js";
import { createPiTraceEvent } from "./AgentPiTraceProjector.js";
import type { AgentPiRuntimeService } from "./AgentPiSubstrate.js";

export interface AgentPiSessionMutationRuntime {
  services: {
    pi: AgentPiRuntimeService;
  };
}

export interface AgentPiSessionMutationRuntimeLease {
  runtime: AgentPiSessionMutationRuntime;
  release(): void;
}

export interface AgentPiSessionMutationServiceOptions {
  acquireRuntime: (modelProviderId?: string) => AgentPiSessionMutationRuntimeLease;
}

export interface AgentPiSessionMutationRequest {
  sessionId: string;
  modelProviderId?: string;
  onEvent?: AgentEventSink;
}

export interface AgentPiSessionMutationPort {
  rewind(request: AgentPiSessionMutationRequest & { entryId: string }): Promise<boolean>;
  reset(request: AgentPiSessionMutationRequest): Promise<boolean>;
}

const PiSessionMutationTraceEvents = {
  RewindCompleted: "session.rewind.completed",
  RewindFailed: "session.rewind.failed",
  ResetCompleted: "session.reset.completed",
  ResetFailed: "session.reset.failed",
} as const;

export class AgentPiSessionMutationService implements AgentPiSessionMutationPort {
  constructor(private readonly options: AgentPiSessionMutationServiceOptions) {}

  async reset(request: AgentPiSessionMutationRequest): Promise<boolean> {
    return this.runSessionMutation(
      request,
      PiSessionMutationTraceEvents.ResetCompleted,
      PiSessionMutationTraceEvents.ResetFailed,
      (runtime) => runtime.services.pi.resetSession(request.sessionId),
    );
  }

  async rewind(request: AgentPiSessionMutationRequest & { entryId: string }): Promise<boolean> {
    return this.runSessionMutation(
      request,
      PiSessionMutationTraceEvents.RewindCompleted,
      PiSessionMutationTraceEvents.RewindFailed,
      (runtime) => runtime.services.pi.rewindSession(request.sessionId, request.entryId),
    );
  }

  private async runSessionMutation(
    request: AgentPiSessionMutationRequest,
    completedEventType: string,
    failedEventType: string,
    mutate: (runtime: AgentPiSessionMutationRuntime) => Promise<boolean>,
  ): Promise<boolean> {
    const startedAt = performance.now();
    const runtimeLease = this.options.acquireRuntime(request.modelProviderId);
    const runtimeAcquireMs = elapsedMilliseconds(startedAt);
    const operationStartedAt = performance.now();
    const requestId = createOpaqueId("pi_session_mutation");
    try {
      const mutated = await mutate(runtimeLease.runtime);
      await this.emitTrace(request, requestId, 0, completedEventType, {
        sessionId: request.sessionId,
        mutated,
        runtimeAcquireMs,
        operationMs: elapsedMilliseconds(operationStartedAt),
        durationMs: elapsedMilliseconds(startedAt),
      });
      return mutated;
    } catch (error) {
      await this.emitTrace(request, requestId, 0, failedEventType, {
        sessionId: request.sessionId,
        runtimeAcquireMs,
        operationMs: elapsedMilliseconds(operationStartedAt),
        durationMs: elapsedMilliseconds(startedAt),
        error: serializeError(error),
      });
      throw error;
    } finally {
      runtimeLease.release();
    }
  }

  private async emitTrace(
    request: AgentPiSessionMutationRequest,
    requestId: string,
    step: number,
    eventType: string,
    payload: unknown,
  ): Promise<void> {
    await emitAgentEvent(
      request.onEvent,
      createPiTraceEvent({
        requestId,
        step,
        source: "substrate",
        eventType,
        payload,
      }),
    );
  }
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
