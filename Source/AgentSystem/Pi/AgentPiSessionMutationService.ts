import { createOpaqueId } from "../Core/AgentIds.js";
import { serializeError } from "../Diagnostics/AgentErrorSerializer.js";
import { AgentPiDiagnosticSources, emitAgentPiDiagnostic, type AgentPiDiagnosticSink } from "./AgentPiDiagnostics.js";
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
  diagnostics?: AgentPiDiagnosticSink;
}

export interface AgentPiSessionMutationRequest {
  sessionId: string;
  modelProviderId?: string;
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
      await this.emitDiagnostic(request, requestId, 0, completedEventType, {
        sessionId: request.sessionId,
        mutated,
        runtimeAcquireMs,
        operationMs: elapsedMilliseconds(operationStartedAt),
        durationMs: elapsedMilliseconds(startedAt),
      });
      return mutated;
    } catch (error) {
      await this.emitDiagnostic(request, requestId, 0, failedEventType, {
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

  private async emitDiagnostic(
    request: AgentPiSessionMutationRequest,
    requestId: string,
    step: number,
    name: string,
    details: unknown,
  ): Promise<void> {
    await emitAgentPiDiagnostic(this.options.diagnostics, {
      context: { sessionId: request.sessionId, requestId, step },
      source: AgentPiDiagnosticSources.Substrate,
      name,
      details,
    });
  }
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}
