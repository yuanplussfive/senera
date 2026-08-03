import type { AgentEventSink } from "../Events/AgentEvent.js";
import { AgentEventKinds, emitAgentEvent } from "../Events/AgentEvent.js";
import { serializeError } from "../Diagnostics/AgentErrorSerializer.js";
import type { AgentLocalizedMessage } from "../I18n/AgentMessageCatalog.js";
import { projectAgentErrorMessage, projectAgentMessage } from "../I18n/AgentMessageProjection.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { AgentTurnPreparationSnapshot } from "../Loop/AgentTurnPreparationSnapshot.js";
import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";
import type { AgentSession } from "./AgentSession.js";
import type { AgentSessionAdmissionCoordinator } from "./AgentSessionAdmissionCoordinator.js";
import { AgentSessionControlEpoch } from "./AgentSessionControlEpoch.js";
import type { AgentSessionHistoryMutationCoordinator } from "./AgentSessionHistoryMutationCoordinator.js";
import type { AgentSessionHistoryReplay } from "./AgentSessionHistoryReplay.js";
import {
  clearAgentSessionRegenerationLineage,
  resolveAgentSessionRegenerationLineage,
  withAgentSessionRegenerationLineage,
} from "./AgentSessionLifecycleMetadata.js";
import type { AgentSessionMessageAcceptance, AgentSessionMessageRequest } from "./AgentSessionMessageCoordinator.js";
import type { AgentSessionRunCoordinator } from "./AgentSessionRunCoordinator.js";
import type { AgentSessionStore } from "./AgentSessionStore.js";

export interface AgentSessionHistoryReplayRequest {
  readonly sessionId: string;
  readonly refresh?: boolean;
  readonly onEvent?: AgentEventSink;
}

export interface AgentSessionTruncateRequest {
  readonly sessionId: string;
  readonly requestId: string;
  readonly onEvent?: AgentEventSink;
  readonly preparation?: AgentTurnPreparationSnapshot;
}

export interface AgentSessionRegenerateRequest {
  readonly sessionId: string;
  readonly fromRequestId: string;
  readonly requestId: string;
  readonly modelProviderId?: string;
  readonly input: string;
  readonly attachments?: AgentUploadAttachment[];
  readonly onEvent?: AgentEventSink;
}

export interface AgentSessionMessageAdmissionPort {
  acceptUnderAdmission(request: AgentSessionMessageRequest): Promise<AgentSessionMessageAcceptance>;
}

export interface AgentSessionHistoryControllerOptions {
  readonly store: AgentSessionStore;
  readonly admissions: AgentSessionAdmissionCoordinator;
  readonly replay: AgentSessionHistoryReplay;
  readonly mutations: AgentSessionHistoryMutationCoordinator;
  readonly runs: AgentSessionRunCoordinator;
  readonly messages: AgentSessionMessageAdmissionPort;
  readonly ready: () => Promise<void>;
  readonly logger?: AgentLogger;
}

export class AgentSessionHistoryController {
  private readonly controlEpoch = new AgentSessionControlEpoch();

  constructor(private readonly options: AgentSessionHistoryControllerOptions) {}

  replay(request: AgentSessionHistoryReplayRequest): Promise<void> {
    return this.options.admissions.run(request.sessionId, async () => {
      await this.options.ready();
      await this.recoverSession(request.sessionId);
      await this.options.replay.replay(request);
    });
  }

  truncate(request: AgentSessionTruncateRequest): Promise<void> {
    return this.options.admissions.run(request.sessionId, async () => {
      await this.options.ready();
      this.invalidate(request.sessionId);
      const lookup = this.options.store.get(request.sessionId);
      const truncated =
        lookup.kind === "found" ? await this.truncateExistingSession(lookup.session, request) : undefined;
      if (truncated?.kind === "boundary_missing") {
        await this.emitHistoryBoundaryMissing(request, truncated.requestId);
        return;
      }
      if (lookup.kind === "found") {
        lookup.session.metadata = clearAgentSessionRegenerationLineage(lookup.session.metadata);
        this.options.store.persistMetadata(lookup.session);
      }
      await this.emitSessionTruncated(request, truncated?.removedEntries ?? 0);
    });
  }

  async regenerate(request: AgentSessionRegenerateRequest): Promise<void> {
    await this.options.ready();
    const token = this.controlEpoch.issue(request.sessionId);
    try {
      this.options.runs.requestActiveRunCancellation(request.sessionId);
      let completion: Promise<void> | undefined;
      await this.options.admissions.run(request.sessionId, async () => {
        if (!this.controlEpoch.isCurrent(token)) {
          await this.emitSupersededRegeneration(request);
          return;
        }

        const lookup = this.options.store.get(request.sessionId);
        const inheritedLineage =
          lookup.kind === "found"
            ? resolveAgentSessionRegenerationLineage(lookup.session.metadata, request.fromRequestId)
            : undefined;
        const preparation =
          this.options.store.loadTurnPreparation(request.sessionId, request.fromRequestId) ??
          (inheritedLineage
            ? this.options.store.loadTurnPreparation(request.sessionId, inheritedLineage.currentRequestId)
            : undefined);
        if (lookup.kind === "found") {
          await this.discardActiveRunForRegeneration(lookup.session, request);
        }
        if (!this.controlEpoch.isCurrent(token)) {
          await this.emitSupersededRegeneration(request);
          return;
        }

        const truncationRequestId = this.resolveRegenerationTruncationRequestId(
          request.sessionId,
          request.fromRequestId,
          inheritedLineage?.currentRequestId,
        );
        const mutationResult =
          lookup.kind === "found"
            ? await this.options.mutations.truncate({
                session: lookup.session,
                fromRequestId: truncationRequestId,
                preparation,
              })
            : undefined;
        if (mutationResult?.kind === "boundary_missing") {
          await this.emitHistoryBoundaryMissing(request, mutationResult.requestId);
          return;
        }
        if (lookup.kind === "found") {
          lookup.session.metadata = withAgentSessionRegenerationLineage(lookup.session.metadata, {
            sourceRequestId: inheritedLineage?.sourceRequestId ?? request.fromRequestId,
            currentRequestId: request.requestId,
          });
          this.options.store.persistMetadata(lookup.session);
          if (preparation) {
            this.options.store.persistTurnPreparation(request.sessionId, request.requestId, preparation);
          }
        }
        await this.emitSessionTruncated(
          {
            sessionId: request.sessionId,
            requestId: truncationRequestId,
            replacementRequestId: request.requestId,
            onEvent: request.onEvent,
          },
          mutationResult?.removedEntries ?? 0,
        );
        if (!this.controlEpoch.isCurrent(token)) {
          await this.emitSupersededRegeneration(request);
          return;
        }

        const accepted = await this.options.messages.acceptUnderAdmission({
          sessionId: request.sessionId,
          requestId: request.requestId,
          modelProviderId: request.modelProviderId,
          input: request.input,
          attachments: request.attachments,
          preparation,
          onEvent: request.onEvent,
        });
        completion = accepted.completion;
      });
      await completion;
    } finally {
      this.controlEpoch.retire(token);
    }
  }

  invalidate(sessionId: string): void {
    this.controlEpoch.invalidate(sessionId);
  }

  async recoverAll(): Promise<void> {
    await this.options.mutations.recoverAll();
  }

  async recoverSession(sessionId: string): Promise<void> {
    await this.options.mutations.recoverSession(sessionId);
  }

  private async truncateExistingSession(session: AgentSession, request: AgentSessionTruncateRequest) {
    await this.options.runs.discardActiveRun(session);
    const preparation =
      request.preparation ?? this.options.store.loadTurnPreparation(request.sessionId, request.requestId);
    return this.options.mutations.truncate({
      session,
      fromRequestId: request.requestId,
      preparation,
    });
  }

  private async discardActiveRunForRegeneration(
    session: AgentSession,
    progress: { requestId: string; onEvent?: AgentEventSink },
  ): Promise<void> {
    if (!this.options.runs.hasActiveRun(session.id)) {
      await this.options.runs.discardActiveRun(session);
      return;
    }

    const startedAt = performance.now();
    await this.emitRegenerationCancellationProgress(session.id, progress, { stage: "started" });
    try {
      await this.options.runs.discardActiveRun(session);
      await this.emitRegenerationCancellationProgress(session.id, progress, {
        stage: "completed",
        durationMs: elapsedMilliseconds(startedAt),
      });
    } catch (error) {
      await this.emitRegenerationCancellationProgress(session.id, progress, {
        stage: "failed",
        durationMs: elapsedMilliseconds(startedAt),
        ...projectAgentErrorMessage(error, "session.runFailed"),
      });
      throw error;
    }
  }

  private async emitRegenerationCancellationProgress(
    sessionId: string,
    progress: { requestId: string; onEvent?: AgentEventSink },
    data: {
      stage: "started" | "completed" | "failed";
      durationMs?: number;
      message?: string;
      localizedMessage?: AgentLocalizedMessage;
    },
  ): Promise<void> {
    try {
      await emitAgentEvent(progress.onEvent, {
        kind: AgentEventKinds.RunCancellationProgress,
        context: { sessionId, requestId: progress.requestId },
        data,
      });
    } catch (error) {
      this.options.logger?.warn("session.regeneration_cancellation.telemetry_failed", {
        sessionId,
        requestId: progress.requestId,
        stage: data.stage,
        error: serializeError(error),
      });
    }
  }

  private emitHistoryBoundaryMissing(
    request: { sessionId: string; onEvent?: AgentEventSink },
    requestId: string,
  ): Promise<void> {
    return emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.RequestInvalid,
      context: { sessionId: request.sessionId },
      data: {
        code: "session_history_boundary_missing",
        ...projectAgentMessage("session.historyBoundaryMissing", { requestId }),
        details: { requestId },
      },
    });
  }

  private emitSessionTruncated(
    request: {
      sessionId: string;
      requestId: string;
      replacementRequestId?: string;
      onEvent?: AgentEventSink;
    },
    removedEntries: number,
  ): Promise<void> {
    return emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.SessionTruncated,
      context: { sessionId: request.sessionId },
      data: {
        sessionId: request.sessionId,
        fromRequestId: request.requestId,
        removedEntries,
        replacementRequestId: request.replacementRequestId,
      },
    });
  }

  private emitSupersededRegeneration(request: AgentSessionRegenerateRequest): Promise<void> {
    return emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.RunCancelled,
      context: { sessionId: request.sessionId, requestId: request.requestId },
      data: { reason: "user_cancelled" },
    });
  }

  private resolveRegenerationTruncationRequestId(
    sessionId: string,
    requestedId: string,
    inheritedCurrentId: string | undefined,
  ): string {
    if (this.options.store.hasRequest(sessionId, requestedId)) return requestedId;
    return inheritedCurrentId && this.options.store.hasRequest(sessionId, inheritedCurrentId)
      ? inheritedCurrentId
      : requestedId;
  }
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100);
}
