import { type AgentCancellationError } from "../Core/AgentCancellation.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import type { AgentSession } from "./AgentSession.js";
import type { StoredRunSnapshot } from "./AgentSessionRepository.js";
import { type AgentSessionStore } from "./AgentSessionStore.js";
import { clearAgentSessionCancellation, resolveAgentSessionLifecycle } from "./AgentSessionLifecycleMetadata.js";

export class AgentSessionRunSnapshotWriter {
  constructor(private readonly store: AgentSessionStore) {}

  cancelled(input: {
    sessionId: string;
    requestId: string;
    text: string;
    startedAt: string;
    error: AgentCancellationError;
  }): void {
    const endedAt = new Date().toISOString();
    this.store.persistRunSnapshot({
      sessionId: input.sessionId,
      requestId: input.requestId,
      input: input.text,
      status: "cancelled",
      startedAt: input.startedAt,
      updatedAt: endedAt,
      endedAt,
      errorMessage: input.error.message,
    });
  }

  activeRequestCancelled(session: AgentSession): void {
    const activeRequest = session.activeRequest;
    if (!activeRequest) {
      return;
    }

    const endedAt = new Date().toISOString();
    this.store.persistRunSnapshot({
      sessionId: session.id,
      requestId: activeRequest.requestId,
      input: activeRequest.input,
      status: "cancelled",
      startedAt: activeRequest.startedAt,
      updatedAt: endedAt,
      endedAt,
      errorMessage: agentErrorMessage("session.runCancelled"),
    });
  }

  reconcileOrphanedRunningSnapshots(): void {
    const now = new Date().toISOString();
    const runningBySession = new Map<string, StoredRunSnapshot[]>();
    for (const snapshot of this.store.loadRunningRunSnapshots()) {
      const snapshots = runningBySession.get(snapshot.sessionId) ?? [];
      snapshots.push(snapshot);
      runningBySession.set(snapshot.sessionId, snapshots);
    }
    for (const session of this.store.listSessionMetadata()) {
      const cancellation = resolveAgentSessionLifecycle(session.metadata).cancellation;
      for (const snapshot of runningBySession.get(session.id) ?? []) {
        const cancelled = cancellation?.requestId === snapshot.requestId;
        this.store.persistRunSnapshot({
          ...snapshot,
          status: cancelled ? "cancelled" : "failed",
          updatedAt: now,
          endedAt: now,
          errorMessage: cancelled
            ? agentErrorMessage("session.runCancelled")
            : agentErrorMessage("session.runOrphanedAfterRestart"),
        });
      }
      if (cancellation) {
        session.metadata = clearAgentSessionCancellation(session.metadata);
        session.updatedAt = now;
        this.store.persistMetadata(session);
      }
    }
  }
}
