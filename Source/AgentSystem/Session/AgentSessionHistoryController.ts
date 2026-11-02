import type { AgentEventSink } from "../Events/AgentEvent.js";
import { AgentEventKinds, emitAgentEvent, type AgentEventEnvelope } from "../Events/AgentEvent.js";
import { sha256Hex } from "../Core/AgentHash.js";
import { serializeError } from "../Diagnostics/AgentErrorSerializer.js";
import type { AgentLocalizedMessage } from "../I18n/AgentMessageCatalog.js";
import { projectAgentErrorMessage, projectAgentMessage } from "../I18n/AgentMessageProjection.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import { AgentConversationEntryKinds } from "../Conversation/AgentConversation.js";
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
import type { AgentExplicitActivationSet } from "../Activation/AgentActivationTypes.js";
import type { AgentSessionStore } from "./AgentSessionStore.js";
import type { AgentExecutionApprovalMode } from "../Safety/AgentExecutionApprovalMode.js";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import {
  AgentSessionRecoveryModes,
  readAgentSessionRecoveryModes,
  type AgentSessionRecoveryMode,
} from "./AgentSessionRunRecovery.js";

export interface AgentSessionHistoryReplayRequest {
  readonly sessionId: string;
  readonly refresh?: boolean;
  readonly initialWindow?: boolean;
  readonly before?: string;
  readonly onEvent?: AgentEventSink;
}

export interface AgentSessionRunHistoryReplayRequest {
  readonly sessionId: string;
  readonly requestId: string;
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
  readonly thinkingLevel?: ModelThinkingLevel;
  readonly input: string;
  readonly approvalMode: AgentExecutionApprovalMode;
  readonly attachments?: AgentUploadAttachment[];
  readonly activations?: AgentExplicitActivationSet;
  readonly onEvent?: AgentEventSink;
}

export interface AgentSessionRetryRequest {
  readonly sessionId: string;
  readonly failedRequestId: string;
  readonly requestId: string;
  readonly recoveryMode: AgentSessionRecoveryMode;
  readonly modelProviderId?: string;
  readonly thinkingLevel?: ModelThinkingLevel;
  readonly approvalMode: AgentExecutionApprovalMode;
  readonly activations?: AgentExplicitActivationSet;
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

  async replay(request: AgentSessionHistoryReplayRequest): Promise<void> {
    await this.withRetainedHistoryRead(request.sessionId, async () => {
      await this.options.replay.replay(request);
    });
  }

  async replayRunHistory(request: AgentSessionRunHistoryReplayRequest): Promise<void> {
    await this.withRetainedHistoryRead(request.sessionId, async () => {
      await this.options.replay.replayRunHistory(request);
    });
  }

  truncate(request: AgentSessionTruncateRequest): Promise<void> {
    return this.options.admissions.run(request.sessionId, async () => {
      await this.options.ready();
      this.invalidate(request.sessionId);
      const lookup = this.options.store.get(request.sessionId);
      if (lookup.kind === "missing") {
        await this.emitHistoryBoundaryMissing(request, request.requestId);
        return;
      }
      const conversation = this.options.store.loadConversation(request.sessionId);
      const visited = new Set<string>();
      let boundary = request.requestId;
      while (true) {
        if (visited.has(boundary)) throw new Error("Session queued-message ownership contains a cycle.");
        visited.add(boundary);
        const parent = conversation.find((entry) => entry.requestId === boundary)?.metadata?.queue?.parentRequestId;
        if (!parent) break;
        boundary = parent;
      }
      const effectiveRequest = {
        ...request,
        requestId: boundary,
        ...(boundary !== request.requestId ? { preparation: undefined } : {}),
      };
      const truncated = await this.truncateExistingSession(lookup.session, effectiveRequest);
      if (truncated?.kind === "boundary_missing") {
        await this.emitHistoryBoundaryMissing(request, truncated.requestId);
        return;
      }
      if (lookup.kind === "found") {
        lookup.session.metadata = clearAgentSessionRegenerationLineage(lookup.session.metadata);
        this.options.store.persistMetadata(lookup.session);
      }
      await this.emitSessionTruncated(
        effectiveRequest,
        truncated?.removedEntries ?? 0,
        truncated?.kind === "committed" ? truncated.removedRequestIds : undefined,
      );
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
        const reusablePreparation =
          preparation && preparation.inputDigest === sha256Hex(request.input) ? preparation : undefined;
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
          // Carry the preparation only when this is a true regeneration of
          // the same user input. An edited message must prepare from its new
          // digest; otherwise the old turn can be mistaken for the new one.
          if (reusablePreparation) {
            this.options.store.persistTurnPreparation(request.sessionId, request.requestId, reusablePreparation);
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
          mutationResult?.kind === "committed" ? mutationResult.removedRequestIds : undefined,
        );
        if (!this.controlEpoch.isCurrent(token)) {
          await this.emitSupersededRegeneration(request);
          return;
        }

        const accepted = await this.options.messages.acceptUnderAdmission({
          sessionId: request.sessionId,
          requestId: request.requestId,
          modelProviderId: request.modelProviderId,
          thinkingLevel: request.thinkingLevel,
          input: request.input,
          approvalMode: request.approvalMode,
          attachments: request.attachments,
          activations: request.activations,
          preparation: reusablePreparation,
          onEvent: request.onEvent,
        });
        completion = accepted.completion;
      });
      await completion;
    } finally {
      this.controlEpoch.retire(token);
    }
  }

  async retry(request: AgentSessionRetryRequest): Promise<void> {
    await this.options.ready();
    await this.options.admissions.run(request.sessionId, async () => {
      const lookup = this.options.store.get(request.sessionId);
      if (lookup.kind === "missing") {
        throw new Error(`Session ${request.sessionId} was not found.`);
      }
      if (this.options.runs.hasActiveRun(request.sessionId)) {
        throw new Error(`Session ${request.sessionId} still has an active run.`);
      }

      await this.recoverSession(request.sessionId);
      lookup.session.conversation = this.options.store.loadConversation(request.sessionId);
      const snapshot = this.options.store.loadRunSnapshot(request.sessionId, request.failedRequestId);
      if (!snapshot) throw new Error(`Run ${request.failedRequestId} was not found.`);
      if (!readAgentSessionRecoveryModes(snapshot.status).includes(request.recoveryMode)) {
        throw new Error(`Run ${request.failedRequestId} is not terminal and cannot be recovered.`);
      }

      const loadRunStartedEvent = (requestId: string): AgentEventEnvelope | undefined =>
        this.options.store.loadRunEvent(request.sessionId, requestId, AgentEventKinds.RunStarted);
      const runStartedEvent = loadRunStartedEvent(request.failedRequestId);
      const sourceRequestId = resolveRecoverySourceRequestId(
        lookup.session.conversation,
        request.failedRequestId,
        runStartedEvent,
        loadRunStartedEvent,
      );
      const sourceEntry = lookup.session.conversation.find(
        (entry): entry is Extract<AgentSession["conversation"][number], { kind: "user.message" }> =>
          entry.kind === AgentConversationEntryKinds.UserMessage && entry.requestId === sourceRequestId,
      );
      // Recovery keeps the durable user message as the input identity. The
      // Pi request distinguishes native continuation from a full retry; no
      // synthetic user message containing the literal word "continue" is
      // appended to the conversation.
      const input = requireRecoveryUserInput(sourceEntry, request.failedRequestId);
      const attachments = sourceEntry?.attachments ?? readRunStartedAttachments(runStartedEvent);
      const preparation = this.options.store.loadTurnPreparation(request.sessionId, request.failedRequestId);

      if (request.recoveryMode === AgentSessionRecoveryModes.Retry) {
        if (preparation?.piBranchBoundaryId) {
          const rewound = await this.options.mutations.rewindForRetry({
            session: lookup.session,
            preparation,
          });
          if (!rewound) throw new Error(`Pi session could not rewind run ${request.failedRequestId}.`);
        }
      }

      // A retry starts a new turn. The model receipt on the failed snapshot is
      // historical evidence for rendering and recovery, not a routing choice;
      // it may refer to a provider that has since been removed or reconfigured.
      // When the caller does not select a model, let the current runtime resolve
      // the active session/default configuration.
      const modelProviderId = request.modelProviderId;
      const completion = this.options.runs.runTurn(lookup.session, {
        requestId: request.requestId,
        modelProviderId,
        thinkingLevel: request.thinkingLevel,
        input,
        approvalMode: request.approvalMode,
        attachments,
        activations: request.activations,
        preparation: request.recoveryMode === AgentSessionRecoveryModes.Retry ? preparation : undefined,
        recovery: {
          mode: request.recoveryMode,
          sourceRequestId: request.failedRequestId,
        },
        reuseUserEntryFromRequestId: sourceRequestId,
        ...(request.recoveryMode === AgentSessionRecoveryModes.Continue
          ? {
              continueFromTranscript: true,
              continuationSourceRequestId: sourceRequestId,
              metadata: {
                recovery: {
                  mode: request.recoveryMode,
                  sourceRequestId: request.failedRequestId,
                },
              },
            }
          : {}),
        onEvent: request.onEvent,
      });
      await completion;
    });
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

  /**
   * History is a snapshot read. It must not queue behind an active turn: a
   * reconnect while a model is working still needs the transcript, approvals
   * and live run state immediately. Retention only prevents the working-set
   * cache from evicting the session while its fixed snapshot is streamed.
   *
   * A pending destructive history mutation is the one exception. Recover it
   * through the normal admission lane before reading so the snapshot cannot
   * straddle a truncated branch.
   */
  private async withRetainedHistoryRead<TValue>(sessionId: string, operation: () => Promise<TValue>): Promise<TValue> {
    await this.options.ready();
    const releaseRetention = this.options.store.retainWorkingSession(sessionId);
    try {
      if (this.options.store.loadPendingHistoryMutation(sessionId)) {
        await this.options.admissions.run(sessionId, () => this.recoverSession(sessionId));
      }
      return await operation();
    } finally {
      releaseRetention();
    }
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
    removedRequestIds?: readonly string[],
  ): Promise<void> {
    return emitAgentEvent(request.onEvent, {
      kind: AgentEventKinds.SessionTruncated,
      context: { sessionId: request.sessionId },
      data: {
        sessionId: request.sessionId,
        fromRequestId: request.requestId,
        removedEntries,
        replacementRequestId: request.replacementRequestId,
        ...(removedRequestIds && removedRequestIds.length > 0 ? { removedRequestIds: [...removedRequestIds] } : {}),
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

function resolveRecoverySourceRequestId(
  entries: readonly { kind: string; requestId: string }[],
  requestId: string,
  runStartedEvent: AgentEventEnvelope | undefined,
  loadRunStartedEvent: (requestId: string) => AgentEventEnvelope | undefined,
): string {
  const visited = new Set<string>();
  let current = requestId;
  while (!visited.has(current)) {
    visited.add(current);
    const next = readRecoverySourceRequestId(runStartedEvent);
    if (next && next !== current) {
      current = next;
      runStartedEvent = loadRunStartedEvent(current);
      continue;
    }
    if (
      entries.some((entry) => entry.kind === AgentConversationEntryKinds.UserMessage && entry.requestId === current)
    ) {
      return current;
    }
    return current;
  }
  return current;
}

function readRecoverySourceRequestId(started: AgentEventEnvelope | undefined): string | undefined {
  if (!started || !started.data || typeof started.data !== "object") return undefined;
  const recovery = (started.data as { recovery?: unknown }).recovery;
  if (!recovery || typeof recovery !== "object") return undefined;
  const sourceRequestId = (recovery as { sourceRequestId?: unknown }).sourceRequestId;
  return typeof sourceRequestId === "string" && sourceRequestId ? sourceRequestId : undefined;
}

function readRunStartedAttachments(started: AgentEventEnvelope | undefined): AgentUploadAttachment[] | undefined {
  if (!started || !started.data || typeof started.data !== "object") return undefined;
  const attachments = (started.data as { attachments?: unknown }).attachments;
  return Array.isArray(attachments) ? (attachments as AgentUploadAttachment[]) : undefined;
}

function requireRecoveryUserInput(
  entry: Extract<AgentSession["conversation"][number], { kind: "user.message" }> | undefined,
  requestId: string,
): string {
  if (!entry) throw new Error(`Run ${requestId} has no durable user entry to retry.`);
  return entry.content;
}
