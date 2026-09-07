import { createOpaqueId } from "../Core/AgentIds.js";
import { AgentKeyedLeaseQueue } from "../Core/AgentKeyedLeaseQueue.js";
import {
  AgentPiSessionLifecycleStates,
  resolveAgentPiSessionLifecycle,
  withAgentPiSessionLifecycle,
} from "../Pi/AgentPiSessionLifecycleMetadata.js";
import type { AgentPiSessionMutationPort } from "../Pi/AgentPiSessionMutationService.js";
import type { AgentTurnPreparationSnapshot } from "../Loop/AgentTurnPreparationSnapshot.js";
import type { AgentSession } from "./AgentSession.js";
import {
  AgentSessionHistoryMutationKinds,
  AgentSessionPiMutationKinds,
  type AgentSessionHistoryMutation,
  type AgentSessionPiMutation,
} from "./AgentSessionHistoryMutation.js";
import type { AgentSessionStore } from "./AgentSessionStore.js";
import type { AgentMemoryService } from "../Memory/AgentMemoryService.js";
import type { AgentSessionArtifactLifecycle } from "./AgentSessionArtifactLifecycle.js";

export interface AgentSessionHistoryMutationCoordinatorOptions {
  readonly store: AgentSessionStore;
  readonly piSessions?: AgentPiSessionMutationPort;
  readonly memory?: Pick<AgentMemoryService, "deleteFromSessionRequest">;
  readonly artifacts?: Pick<AgentSessionArtifactLifecycle, "removeSessionArtifactsFromRequests">;
}

export interface AgentSessionHistoryMutationResult {
  readonly kind: "committed";
  readonly mutation: AgentSessionHistoryMutation;
  readonly removedEntries: number;
}

export interface AgentSessionHistoryMutationBoundaryMissing {
  readonly kind: "boundary_missing";
  readonly sessionId: string;
  readonly requestId: string;
}

export type AgentSessionHistoryMutationOutcome =
  AgentSessionHistoryMutationResult | AgentSessionHistoryMutationBoundaryMissing;

export class AgentSessionHistoryMutationCoordinator {
  private readonly leases = new AgentKeyedLeaseQueue<string>();

  constructor(private readonly options: AgentSessionHistoryMutationCoordinatorOptions) {}

  async recoverAll(): Promise<AgentSessionHistoryMutationResult[]> {
    const results: AgentSessionHistoryMutationResult[] = [];
    for (const mutation of this.options.store.listPendingHistoryMutations()) {
      const result = await this.leases.run(mutation.sessionId, () => this.recoverMutation(mutation));
      if (result) results.push(result);
    }
    return results;
  }

  recoverSession(sessionId: string): Promise<AgentSessionHistoryMutationResult | undefined> {
    return this.leases.run(sessionId, async () => {
      const mutation = this.options.store.loadPendingHistoryMutation(sessionId);
      return mutation ? this.recoverMutation(mutation) : undefined;
    });
  }

  truncate(request: {
    session: AgentSession;
    fromRequestId: string;
    preparation?: AgentTurnPreparationSnapshot;
  }): Promise<AgentSessionHistoryMutationOutcome> {
    return this.leases.run(request.session.id, async () => {
      const pending = this.options.store.loadPendingHistoryMutation(request.session.id);
      if (pending) await this.recoverMutation(pending);

      if (!this.options.store.hasRequest(request.session.id, request.fromRequestId)) {
        return {
          kind: "boundary_missing",
          sessionId: request.session.id,
          requestId: request.fromRequestId,
        };
      }

      const mutation = createHistoryMutation(request.session, request.fromRequestId, request.preparation);
      this.options.store.stageHistoryMutation(mutation);
      return this.applyAndCommit(mutation, request.session);
    });
  }

  private async recoverMutation(
    mutation: AgentSessionHistoryMutation,
  ): Promise<AgentSessionHistoryMutationResult | undefined> {
    const lookup = this.options.store.get(mutation.sessionId);
    if (lookup.kind === "missing") return undefined;
    return this.applyAndCommit(mutation, lookup.session);
  }

  private async applyAndCommit(
    mutation: AgentSessionHistoryMutation,
    session: AgentSession,
  ): Promise<AgentSessionHistoryMutationResult> {
    const piState = await this.applyPiMutation(mutation);
    await this.applyOwnedHistoryCleanup(mutation);
    const committedSession: AgentSession = {
      ...session,
      updatedAt: new Date().toISOString(),
      metadata:
        piState === undefined
          ? session.metadata
          : withAgentPiSessionLifecycle(session.metadata, piState, readModelProviderId(mutation.pi)),
    };
    return {
      kind: "committed",
      mutation,
      removedEntries: this.options.store.commitHistoryMutation(mutation, committedSession),
    };
  }

  private async applyOwnedHistoryCleanup(mutation: AgentSessionHistoryMutation): Promise<void> {
    const requestIds = this.options.store.requestIdsFrom(mutation.sessionId, mutation.fromRequestId);
    if (requestIds.length === 0) return;
    await this.options.artifacts?.removeSessionArtifactsFromRequests(mutation.sessionId, requestIds);
    this.options.memory?.deleteFromSessionRequest(mutation.sessionId, mutation.fromRequestId);
  }

  private async applyPiMutation(
    mutation: AgentSessionHistoryMutation,
  ): Promise<(typeof AgentPiSessionLifecycleStates)[keyof typeof AgentPiSessionLifecycleStates] | undefined> {
    const pi = mutation.pi;
    if (pi.kind === AgentSessionPiMutationKinds.None) return undefined;
    const service = this.options.piSessions;
    if (!service) throw new Error(`Pi session mutation service is required for ${mutation.sessionId}.`);

    const context = {
      sessionId: mutation.sessionId,
      modelProviderId: pi.modelProviderId,
    };
    if (pi.kind === AgentSessionPiMutationKinds.Reset) {
      await service.reset(context);
      return AgentPiSessionLifecycleStates.Absent;
    }

    const rewound = await service.rewind({ ...context, entryId: pi.entryId });
    if (rewound) return AgentPiSessionLifecycleStates.Initialized;
    await service.reset(context);
    return AgentPiSessionLifecycleStates.Absent;
  }
}

function createHistoryMutation(
  session: AgentSession,
  fromRequestId: string,
  preparation: AgentTurnPreparationSnapshot | undefined,
): AgentSessionHistoryMutation {
  const lifecycle = resolveAgentPiSessionLifecycle(session.metadata);
  return {
    mutationId: createOpaqueId("session_history_mutation"),
    kind: AgentSessionHistoryMutationKinds.Truncate,
    sessionId: session.id,
    fromRequestId,
    pi: projectPiMutation(lifecycle, preparation),
    createdAt: new Date().toISOString(),
  };
}

function projectPiMutation(
  lifecycle: ReturnType<typeof resolveAgentPiSessionLifecycle>,
  preparation: AgentTurnPreparationSnapshot | undefined,
): AgentSessionPiMutation {
  if (preparation?.piBranchBoundaryId) {
    return {
      kind: AgentSessionPiMutationKinds.Rewind,
      entryId: preparation.piBranchBoundaryId,
      modelProviderId: lifecycle.modelProviderId,
    };
  }
  return lifecycle.initialized
    ? { kind: AgentSessionPiMutationKinds.Reset, modelProviderId: lifecycle.modelProviderId }
    : { kind: AgentSessionPiMutationKinds.None };
}

function readModelProviderId(pi: AgentSessionPiMutation): string | undefined {
  return pi.kind === AgentSessionPiMutationKinds.None ? undefined : pi.modelProviderId;
}
