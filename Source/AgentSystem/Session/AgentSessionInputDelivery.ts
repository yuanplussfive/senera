import { createRequestId } from "../Core/AgentIds.js";
import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { AgentModelTokenEstimator } from "../Text/AgentTextBudget.js";
import { estimateAgentModelInputTokens } from "../Text/AgentMultimodalTokenBudget.js";
import { escapeXml } from "../Prompt/AgentPromptXml.js";
import { emitAgentEvent, AgentEventKinds, type AgentEventSink } from "../Events/AgentEvent.js";
import type { AgentSessionStore } from "./AgentSessionStore.js";
import type { AgentSessionMessageRequest } from "./AgentSessionMessageCoordinator.js";
import type { AgentConversationProjector } from "../Conversation/AgentConversationProjector.js";
import type { AgentConversationPolicy } from "../Conversation/AgentConversationPolicy.js";
import type { AgentPiActiveSessionHandle } from "../Pi/AgentPiActiveSessionRegistry.js";
import type { AgentImageNormalizationService } from "../Images/AgentImageNormalizationService.js";
import { projectAgentPiImageAttachments } from "../Pi/AgentPiImageAttachmentProjector.js";
import {
  resolveAgentTurnAttachmentReferences,
  type AgentTurnAttachmentUploadStore,
} from "../Prompt/AgentTurnRequestComposer.js";
import { projectSessionUserEntry } from "./AgentSessionRunProjection.js";
import {
  assertMatchingQueuedInput,
  type AgentSessionInputBoundary,
  type AgentSessionInputState,
  type AgentSessionQueuedInput,
} from "./AgentSessionQueuedInput.js";

export interface AgentSessionInputDeliveryOptions {
  readonly onQueuedInputAccepted?: (input: AgentSessionQueuedInput) => void;
  readonly store: AgentSessionStore;
  readonly conversationProjector: AgentConversationProjector;
  readonly conversationPolicy: AgentConversationPolicy;
  readonly uploadStore?: AgentTurnAttachmentUploadStore;
  readonly imageNormalization?: Pick<AgentImageNormalizationService, "normalize">;
}

/** Senera owns acceptance; Pi owns scheduling and the committed transcript. */
export class AgentSessionInputDelivery {
  private readonly scheduled = new Map<string, Set<string>>();

  constructor(private readonly options: AgentSessionInputDeliveryOptions) {}

  async accept(request: AgentSessionMessageRequest, parentRequestId: string): Promise<void> {
    const { onEvent: _onEvent, admissionGuard: _guard, preparation: _preparation, ...payload } = request;
    if (!payload.queueMode) throw new Error("Queued input requires an explicit scheduling mode.");
    const requestId = payload.requestId?.trim() || createRequestId();
    const now = new Date().toISOString();
    const entry = projectSessionUserEntry(
      this.options.conversationProjector,
      requestId,
      {
        ...request,
        queue: { parentRequestId, mode: payload.queueMode, status: "pending" },
      },
      now,
    );
    const input: AgentSessionQueuedInput = {
      sessionId: request.sessionId,
      requestId,
      parentRequestId,
      payloadHash: sha256HexOfCanonicalJson({ ...payload, requestId }),
      state: "pending",
      createdAt: now,
      updatedAt: now,
      request: { ...payload, requestId, queueMode: payload.queueMode },
      entry,
    };
    const existing = this.options.store.loadQueuedInput(input.sessionId, requestId);
    if (existing) assertMatchingQueuedInput(existing, input);
    else this.options.store.saveQueuedInput(input);
    if (!existing) this.options.onQueuedInputAccepted?.(input);
    await publishAgentSessionQueuedInput(existing ?? input, request.onEvent);
  }

  async boundary(
    boundary: AgentSessionInputBoundary,
    handle: AgentPiActiveSessionHandle,
    onEvent: AgentEventSink | undefined,
    delivered: (input: AgentSessionQueuedInput) => void | Promise<void>,
    signal: AbortSignal,
  ): Promise<void> {
    const key = JSON.stringify([boundary.sessionId, boundary.requestId]);
    const scheduled = this.scheduled.get(key) ?? new Set<string>();
    this.scheduled.set(key, scheduled);
    for (const input of this.options.store.listQueuedInputs(boundary.sessionId)) {
      const ownsInitialInput = input.requestId === boundary.requestId && boundary.phase === "observe";
      if (
        input.state !== "pending" ||
        (!ownsInitialInput && (!input.wireInput || !boundary.committedInputs.has(input.wireInput)))
      )
        continue;
      const committed = this.save({ ...input, parentRequestId: boundary.requestId }, "delivered");
      await delivered(committed);
      await publishAgentSessionQueuedInput(committed, onEvent, boundary.requestId);
    }
    if (signal.aborted || boundary.phase === "observe") return;
    const pending = this.options.store
      .listQueuedInputs(boundary.sessionId)
      .filter(
        (input) =>
          input.state === "pending" &&
          input.request.executionScope !== "turn" &&
          !scheduled.has(input.requestId) &&
          (input.requestId !== boundary.requestId || boundary.continuation) &&
          (input.request.queueMode === "steer" || boundary.phase === "follow_up"),
      );
    if (!pending.length) return;

    // One native queue item preserves the complete chronological batch. Pi's
    // one-at-a-time setting no longer adds a model roundtrip per keystroke burst.
    const parts: string[] = [];
    const images: Awaited<ReturnType<typeof projectAgentPiImageAttachments>>[number][] = [];
    const ready: AgentSessionQueuedInput[] = [];
    const estimator = handle.tokenBudget
      ? new AgentModelTokenEstimator({ model: handle.tokenBudget.model })
      : undefined;
    const capacity = handle.tokenBudget?.availableTokens();
    for (const input of pending) {
      try {
        const references = await resolveAgentTurnAttachmentReferences(
          input.request.attachments,
          this.options.uploadStore,
        );
        const media = await projectAgentPiImageAttachments({
          attachments: input.request.attachments,
          model: handle.session.model,
          uploadStore: this.options.uploadStore,
          imageNormalization: this.options.imageNormalization,
          imageInputCapabilities: handle.imageInputCapabilities,
          signal,
        });
        const text = this.options.conversationPolicy.renderCurrentUserMessage(
          input.entry,
          input.request.interaction,
          references,
        );
        const part = `<senera_queued_input id="${escapeXml(input.requestId)}">\n${text}\n</senera_queued_input>`;
        // Preserve whole messages and order. Inputs that do not fit remain
        // pending for a later boundary or a fresh turn, never truncated.
        if (
          capacity !== undefined &&
          estimator &&
          estimateAgentModelInputTokens(estimator, {
            text: [...parts, part].join("\n\n"),
            images: [...images, ...media],
          }) > capacity
        )
          break;
        scheduled.add(input.requestId);
        parts.push(part);
        images.push(...media);
        ready.push(input);
      } catch (error) {
        if (signal.aborted) {
          scheduled.delete(input.requestId);
          return;
        }
        await publishAgentSessionQueuedInput(
          this.save(input, "failed", errorMessage(error)),
          onEvent,
          boundary.requestId,
        );
      }
    }
    if (!ready.length || signal.aborted) return;
    const wireInput = parts.join("\n\n");
    for (const input of ready)
      this.options.store.saveQueuedInput({
        ...input,
        parentRequestId: boundary.requestId,
        wireInput,
        updatedAt: new Date().toISOString(),
      });
    const mode =
      boundary.phase === "follow_up" && ready.every((input) => input.request.queueMode === "follow_up")
        ? "followUp"
        : "steer";
    try {
      await handle.session[mode](wireInput, images);
    } catch (error) {
      for (const input of ready) scheduled.delete(input.requestId);
      throw error;
    }
  }

  async settle(
    sessionId: string,
    parentRequestId: string,
    state: "completed" | "failed" | "cancelled",
    onEvent?: AgentEventSink,
    preservePending = false,
  ): Promise<void> {
    try {
      for (const input of this.options.store.listQueuedInputs(sessionId)) {
        if (input.parentRequestId !== parentRequestId) continue;
        if (input.state !== "delivered" && !(state === "cancelled" && !preservePending && input.state === "pending"))
          continue;
        await publishAgentSessionQueuedInput(this.save(input, state), onEvent, parentRequestId);
      }
    } finally {
      this.release(sessionId, parentRequestId);
    }
  }

  release(sessionId: string, requestId: string): void {
    this.scheduled.delete(JSON.stringify([sessionId, requestId]));
  }

  private save(
    input: AgentSessionQueuedInput,
    state: AgentSessionInputState,
    message?: string,
  ): AgentSessionQueuedInput {
    const updated = { ...input, state, errorMessage: message, updatedAt: new Date().toISOString() };
    this.options.store.saveQueuedInput(updated);
    return updated;
  }
}

export async function publishAgentSessionQueuedInput(
  input: AgentSessionQueuedInput,
  sink?: AgentEventSink,
  contextRequestId = input.requestId,
): Promise<void> {
  await emitAgentEvent(sink, {
    kind: AgentEventKinds.SessionMessageQueued,
    context: { sessionId: input.sessionId, requestId: contextRequestId },
    data: {
      sessionId: input.sessionId,
      requestId: input.requestId,
      parentRequestId: input.parentRequestId,
      mode: input.request.queueMode,
      status: input.state,
      entry: {
        ...input.entry,
        metadata: {
          ...input.entry.metadata,
          queue: {
            parentRequestId: input.parentRequestId,
            mode: input.request.queueMode,
            status: input.state,
            ...(input.errorMessage ? { message: input.errorMessage } : {}),
          },
        },
      },
      ...(input.errorMessage ? { message: input.errorMessage } : {}),
    },
  });
}
