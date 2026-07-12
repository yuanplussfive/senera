import { type AgentCancellationError } from "../Core/AgentCancellation.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import type { AgentModelProviderMetadata } from "../ModelEndpoints/AgentModelMetadata.js";
import type { AgentSession } from "./AgentSession.js";
import { type AgentSessionStore } from "./AgentSessionStore.js";

export class AgentSessionRunSnapshotWriter {
  constructor(private readonly store: AgentSessionStore) {}

  running(input: { sessionId: string; requestId: string; text: string; startedAt: string }): void {
    this.store.persistRunSnapshot({
      sessionId: input.sessionId,
      requestId: input.requestId,
      input: input.text,
      status: "running",
      startedAt: input.startedAt,
      updatedAt: input.startedAt,
    });
  }

  completed(input: {
    sessionId: string;
    requestId: string;
    text: string;
    startedAt: string;
    endedAt: string;
    modelProvider?: AgentModelProviderMetadata;
  }): void {
    this.store.persistRunSnapshot({
      sessionId: input.sessionId,
      requestId: input.requestId,
      input: input.text,
      status: "completed",
      startedAt: input.startedAt,
      updatedAt: input.endedAt,
      endedAt: input.endedAt,
      modelProvider: input.modelProvider,
    });
  }

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

  failed(input: { sessionId: string; requestId: string; text: string; startedAt: string; error: unknown }): void {
    const endedAt = new Date().toISOString();
    this.store.persistRunSnapshot({
      sessionId: input.sessionId,
      requestId: input.requestId,
      input: input.text,
      status: "failed",
      startedAt: input.startedAt,
      updatedAt: endedAt,
      endedAt,
      errorMessage: readErrorMessage(input.error),
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

  failOrphanedRunningSnapshots(): void {
    const now = new Date().toISOString();
    for (const session of this.store.listSessions()) {
      const snapshots = this.store.loadRunSnapshots(session.id);
      for (const snapshot of snapshots) {
        if (snapshot.status !== "running") continue;
        this.store.persistRunSnapshot({
          ...snapshot,
          status: "failed",
          updatedAt: now,
          endedAt: now,
          errorMessage: agentErrorMessage("session.runOrphanedAfterRestart"),
        });
      }
    }
  }
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return agentErrorMessage("session.runFailed");
  }
}
