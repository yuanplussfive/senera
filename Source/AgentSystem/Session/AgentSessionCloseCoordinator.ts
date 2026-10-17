import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import { serializeError } from "../Diagnostics/AgentErrorSerializer.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { releaseAgentLifecycleResources } from "../Core/AgentLifecycleResource.js";
import type { AgentMemoryService } from "../Memory/AgentMemoryService.js";
import { resolveAgentPiSessionLifecycle } from "../Pi/AgentPiSessionLifecycleMetadata.js";
import type { AgentPiSessionMutationPort } from "../Pi/AgentPiSessionMutationService.js";
import type { AgentSession } from "./AgentSession.js";
import type { AgentSessionArtifactLifecycle } from "./AgentSessionArtifactLifecycle.js";
import {
  resolveAgentSessionLifecycle,
  withAgentSessionCloseFailure,
  withAgentSessionCloseIntent,
} from "./AgentSessionLifecycleMetadata.js";
import type { AgentSessionResource } from "./AgentSessionResource.js";
import type { AgentSessionRunCoordinator } from "./AgentSessionRunCoordinator.js";
import type { AgentSessionCloseResult, AgentSessionStore } from "./AgentSessionStore.js";
import { cloneAgentSessionState, replaceAgentSessionState } from "./AgentSessionRunProjection.js";

export interface AgentSessionCloseCoordinatorOptions {
  readonly store: AgentSessionStore;
  readonly runs: Pick<AgentSessionRunCoordinator, "discardActiveRun">;
  readonly memory: Pick<AgentMemoryService, "deleteSession">;
  readonly piSessions?: Pick<AgentPiSessionMutationPort, "reset">;
  readonly resources?: readonly AgentSessionResource[];
  readonly artifacts?: Pick<AgentSessionArtifactLifecycle, "removeSessionArtifacts">;
  readonly logger?: AgentLogger;
  readonly onClosed?: (sessionId: string) => void;
}

export class AgentSessionCloseCoordinator {
  constructor(private readonly options: AgentSessionCloseCoordinatorOptions) {}

  async close(session: AgentSession): Promise<AgentSessionCloseResult> {
    this.persistIntent(session);
    try {
      return await this.cleanupAndDelete(session);
    } catch (error) {
      this.persistFailure(session, error);
      throw error;
    }
  }

  async recoverAll(): Promise<void> {
    for (const persisted of this.options.store.listSessionMetadata()) {
      if (!resolveAgentSessionLifecycle(persisted.metadata).close) continue;
      const lookup = this.options.store.get(persisted.id);
      const session = lookup.kind === "found" ? lookup.session : this.options.store.open(persisted.id).session;
      try {
        await this.close(session);
      } catch (error) {
        this.options.logger?.warn("session.close_recovery.failed", {
          sessionId: session.id,
          error: serializeError(error),
        });
      }
    }
  }

  private async cleanupAndDelete(session: AgentSession): Promise<AgentSessionCloseResult> {
    await this.options.runs.discardActiveRun(session);
    await this.releaseResources(session);
    await this.options.artifacts?.removeSessionArtifacts(session.id);
    this.options.memory.deleteSession(session.id);
    this.options.onClosed?.(session.id);
    const closed = this.options.store.close(session.id);
    if (closed.kind === "missing") {
      throw new Error(`Session ${session.id} disappeared during close cleanup.`);
    }
    return closed;
  }

  private async releaseResources(session: AgentSession): Promise<void> {
    const piSession = resolveAgentPiSessionLifecycle(session.metadata);
    const piReset = piSession.initialized
      ? this.options.piSessions?.reset({
          sessionId: session.id,
          modelProviderId: piSession.modelProviderId,
        })
      : undefined;
    const [piOutcome, resourceFailures] = await Promise.all([
      piReset ? Promise.allSettled([piReset]) : Promise.resolve([]),
      releaseAgentLifecycleResources(this.options.resources ?? [], { sessionId: session.id }),
    ]);
    const failures: unknown[] = [];
    for (const outcome of piOutcome) {
      if (outcome.status === "fulfilled") continue;
      failures.push(outcome.reason);
      this.options.logger?.warn("session.pi_resource.cleanup_failed", {
        sessionId: session.id,
        error: serializeError(outcome.reason),
      });
    }
    for (const failure of resourceFailures) {
      failures.push(failure.error);
      this.options.logger?.warn("session.resource.cleanup_failed", {
        sessionId: session.id,
        resource: failure.resourceId,
        error: serializeError(failure.error),
      });
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, `Session ${session.id} cleanup failed.`);
  }

  private persistFailure(session: AgentSession, error: unknown): void {
    const failedSession = cloneAgentSessionState(session);
    failedSession.metadata = withAgentSessionCloseFailure(failedSession.metadata, {
      requestedAt: new Date().toISOString(),
      failures: cleanupFailureMessages(error),
    });
    failedSession.updatedAt = new Date().toISOString();
    this.options.store.persistMetadata(failedSession);
    replaceAgentSessionState(session, failedSession);
  }

  private persistIntent(session: AgentSession): void {
    const requestedAt = new Date().toISOString();
    const pendingSession = cloneAgentSessionState(session);
    pendingSession.metadata = withAgentSessionCloseIntent(pendingSession.metadata, requestedAt);
    pendingSession.updatedAt = requestedAt;
    this.options.store.persistMetadata(pendingSession);
    replaceAgentSessionState(session, pendingSession);
  }
}

function cleanupFailureMessages(error: unknown): string[] {
  if (error instanceof AggregateError) return error.errors.flatMap(cleanupFailureMessages);
  return [errorMessage(error)];
}
