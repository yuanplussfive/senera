import { createOpaqueId } from "../Core/AgentIds.js";
import { serializeError } from "../Diagnostics/AgentErrorSerializer.js";
import { AgentPiDiagnosticSources, emitAgentPiDiagnostic, type AgentPiDiagnosticSink } from "./AgentPiDiagnostics.js";
import type { AgentPiRuntimeService } from "./AgentPiRuntimeTypes.js";
import type {
  AgentPiSessionCompactionResult,
  AgentPiSessionExportFormat,
  AgentPiSessionExportResult,
  AgentPiSessionRuntimeStatus,
} from "./AgentPiSessionManagement.js";

type AgentPiSessionMutationRuntimeService = Pick<
  AgentPiRuntimeService,
  "resetSession" | "rewindSession" | "forkSession" | "compactSession" | "sessionStatus" | "exportSession"
>;

export interface AgentPiSessionMutationRuntime {
  services: {
    pi: AgentPiSessionMutationRuntimeService;
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

export interface AgentPiSessionManagementPort {
  fork(
    request: AgentPiSessionMutationRequest & {
      sourceSessionId: string;
      entryId: string;
    },
  ): Promise<boolean>;
  compact(
    request: AgentPiSessionMutationRequest & { customInstructions?: string },
  ): Promise<AgentPiSessionCompactionResult | undefined>;
  status(request: AgentPiSessionMutationRequest): Promise<AgentPiSessionRuntimeStatus | undefined>;
  export(
    request: AgentPiSessionMutationRequest & { format: AgentPiSessionExportFormat },
  ): Promise<AgentPiSessionExportResult | undefined>;
}

const PiSessionMutationTraceEvents = {
  RewindCompleted: "session.rewind.completed",
  RewindFailed: "session.rewind.failed",
  ForkCompleted: "session.fork.completed",
  ForkFailed: "session.fork.failed",
  ResetCompleted: "session.reset.completed",
  ResetFailed: "session.reset.failed",
  CompactCompleted: "session.compact.completed",
  CompactFailed: "session.compact.failed",
  StatusCompleted: "session.status.completed",
  StatusFailed: "session.status.failed",
  ExportCompleted: "session.export.completed",
  ExportFailed: "session.export.failed",
} as const;

const PiSessionMutationOutcomes = {
  Completed: "completed",
  Unavailable: "unavailable",
  Unchanged: "unchanged",
} as const;

type PiSessionMutationOutcome = (typeof PiSessionMutationOutcomes)[keyof typeof PiSessionMutationOutcomes];

export class AgentPiSessionMutationService implements AgentPiSessionMutationPort, AgentPiSessionManagementPort {
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

  async fork(request: AgentPiSessionMutationRequest & { sourceSessionId: string; entryId: string }): Promise<boolean> {
    return this.runSessionMutation(
      request,
      PiSessionMutationTraceEvents.ForkCompleted,
      PiSessionMutationTraceEvents.ForkFailed,
      (runtime) => runtime.services.pi.forkSession(request.sourceSessionId, request.sessionId, request.entryId),
    );
  }

  compact(
    request: AgentPiSessionMutationRequest & { customInstructions?: string },
  ): Promise<AgentPiSessionCompactionResult | undefined> {
    return this.runSessionMutation(
      request,
      PiSessionMutationTraceEvents.CompactCompleted,
      PiSessionMutationTraceEvents.CompactFailed,
      (runtime) => runtime.services.pi.compactSession(request.sessionId, request.customInstructions),
    );
  }

  status(request: AgentPiSessionMutationRequest): Promise<AgentPiSessionRuntimeStatus | undefined> {
    return this.runSessionMutation(
      request,
      PiSessionMutationTraceEvents.StatusCompleted,
      PiSessionMutationTraceEvents.StatusFailed,
      (runtime) => runtime.services.pi.sessionStatus(request.sessionId),
    );
  }

  export(
    request: AgentPiSessionMutationRequest & { format: AgentPiSessionExportFormat },
  ): Promise<AgentPiSessionExportResult | undefined> {
    return this.runSessionMutation(
      request,
      PiSessionMutationTraceEvents.ExportCompleted,
      PiSessionMutationTraceEvents.ExportFailed,
      (runtime) => runtime.services.pi.exportSession(request.sessionId, request.format),
    );
  }

  private async runSessionMutation<TResult>(
    request: AgentPiSessionMutationRequest,
    completedEventType: string,
    failedEventType: string,
    mutate: (runtime: AgentPiSessionMutationRuntime) => Promise<TResult>,
  ): Promise<TResult> {
    const startedAt = performance.now();
    const runtimeLease = this.options.acquireRuntime(request.modelProviderId);
    const runtimeAcquireMs = elapsedMilliseconds(startedAt);
    const operationStartedAt = performance.now();
    const requestId = createOpaqueId("pi_session_mutation");
    try {
      const result = await mutate(runtimeLease.runtime);
      await this.emitDiagnostic(request, requestId, 0, completedEventType, {
        sessionId: request.sessionId,
        outcome: projectPiSessionMutationOutcome(result),
        runtimeAcquireMs,
        operationMs: elapsedMilliseconds(operationStartedAt),
        durationMs: elapsedMilliseconds(startedAt),
      });
      return result;
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

function projectPiSessionMutationOutcome(result: unknown): PiSessionMutationOutcome {
  if (result === undefined) return PiSessionMutationOutcomes.Unavailable;
  if (result === false) return PiSessionMutationOutcomes.Unchanged;
  return PiSessionMutationOutcomes.Completed;
}
