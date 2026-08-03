import { createOpaqueId } from "../Core/AgentIds.js";
import { resolveAgentPiSessionLifecycle } from "../Pi/AgentPiSessionLifecycleMetadata.js";
import type { AgentPiSessionManagementPort, AgentPiSessionMutationPort } from "../Pi/AgentPiSessionMutationService.js";
import { AgentSessionAdmissionCoordinator } from "./AgentSessionAdmissionCoordinator.js";
import type { AgentSessionArtifactLifecycle } from "./AgentSessionArtifactLifecycle.js";
import { AgentSessionForkPiMutationKinds, type AgentSessionForkMutation } from "./AgentSessionForkMutation.js";
import type { AgentSessionForkResult, AgentSessionStore } from "./AgentSessionStore.js";

export type AgentSessionForkOutcome =
  | AgentSessionForkResult
  | { readonly kind: "pi_unavailable"; readonly sessionId: string }
  | { readonly kind: "pi_failed"; readonly sessionId: string };

export interface AgentSessionForkCoordinatorOptions {
  readonly store: AgentSessionStore;
  readonly admissions: AgentSessionAdmissionCoordinator;
  readonly piManagement?: Pick<AgentPiSessionManagementPort, "fork">;
  readonly piMutations?: Pick<AgentPiSessionMutationPort, "reset">;
  readonly artifacts?: AgentSessionArtifactLifecycle;
  readonly recoverSourceHistory?: (sessionId: string) => Promise<void>;
}

export class AgentSessionForkCoordinator {
  constructor(private readonly options: AgentSessionForkCoordinatorOptions) {}

  async recoverAll(): Promise<void> {
    for (const mutation of this.options.store.listPendingForkMutations()) {
      await this.rollback(mutation);
    }
  }

  fork(request: {
    sourceSessionId: string;
    sessionId: string;
    throughRequestId: string;
  }): Promise<AgentSessionForkOutcome> {
    return this.options.admissions.runMany([request.sourceSessionId, request.sessionId], async () => {
      const pending = this.options.store.loadPendingForkMutation(request.sessionId);
      if (pending) await this.rollback(pending);
      await this.options.recoverSourceHistory?.(request.sourceSessionId);

      const source = this.options.store.get(request.sourceSessionId);
      const lifecycle = source.kind === "found" ? resolveAgentPiSessionLifecycle(source.session.metadata) : undefined;
      const turnPreparation = this.options.store.loadTurnPreparation(request.sourceSessionId, request.throughRequestId);
      const piBoundaryId = turnPreparation?.piBranchBoundaryId;
      const piReady = Boolean(
        lifecycle?.initialized && piBoundaryId && this.options.piManagement && this.options.piMutations,
      );
      const preparation = this.options.store.prepareFork({
        ...request,
        piBranchBoundaryId: piReady ? piBoundaryId : undefined,
      });
      if (preparation.kind !== "prepared") return preparation;
      if (lifecycle?.initialized && !piReady) {
        return { kind: "pi_unavailable", sessionId: request.sessionId };
      }

      const mutation: AgentSessionForkMutation = {
        mutationId: createOpaqueId("session_fork_mutation"),
        sourceSessionId: request.sourceSessionId,
        targetSessionId: request.sessionId,
        throughRequestId: request.throughRequestId,
        pi:
          piReady && piBoundaryId && lifecycle
            ? {
                kind: AgentSessionForkPiMutationKinds.Fork,
                entryId: piBoundaryId,
                modelProviderId: lifecycle.modelProviderId,
              }
            : { kind: AgentSessionForkPiMutationKinds.None },
        createdAt: new Date().toISOString(),
      };
      this.options.store.stageForkMutation(mutation);

      try {
        const piForked = await this.applyPiFork(mutation);
        if (!piForked) {
          await this.rollback(mutation);
          return { kind: "pi_failed", sessionId: request.sessionId };
        }
        await this.options.artifacts?.retainForkArtifacts({
          sourceSessionId: request.sourceSessionId,
          targetSessionId: request.sessionId,
          requestIds: preparation.requestIds,
        });
        return this.options.store.commitForkMutation(mutation, preparation);
      } catch (error) {
        try {
          await this.rollback(mutation);
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], `Session fork rollback failed: ${request.sessionId}`, {
            cause: rollbackError,
          });
        }
        throw error;
      }
    });
  }

  private applyPiFork(mutation: AgentSessionForkMutation): Promise<boolean> {
    if (mutation.pi.kind === AgentSessionForkPiMutationKinds.None) return Promise.resolve(true);
    const service = this.options.piManagement;
    if (!service) throw new Error(`Pi fork service is required for ${mutation.targetSessionId}.`);
    return service.fork({
      sourceSessionId: mutation.sourceSessionId,
      sessionId: mutation.targetSessionId,
      modelProviderId: mutation.pi.modelProviderId,
      entryId: mutation.pi.entryId,
    });
  }

  private async rollback(mutation: AgentSessionForkMutation): Promise<void> {
    const operations: Promise<unknown>[] = [];
    if (mutation.pi.kind === AgentSessionForkPiMutationKinds.Fork) {
      const service = this.options.piMutations;
      if (!service) throw new Error(`Pi reset service is required to recover ${mutation.targetSessionId}.`);
      operations.push(
        service.reset({
          sessionId: mutation.targetSessionId,
          modelProviderId: mutation.pi.modelProviderId,
        }),
      );
    }
    if (this.options.artifacts) {
      operations.push(this.options.artifacts.removeSessionArtifacts(mutation.targetSessionId));
    }
    const outcomes = await Promise.allSettled(operations);
    const failures = outcomes.flatMap((outcome) => (outcome.status === "rejected" ? [outcome.reason] : []));
    if (failures.length > 0) {
      throw new AggregateError(failures, `Session fork recovery failed: ${mutation.targetSessionId}`);
    }
    if (!this.options.store.abortForkMutation(mutation)) {
      throw new Error(`Pending session fork mutation disappeared during recovery: ${mutation.targetSessionId}`);
    }
  }
}
