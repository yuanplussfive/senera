import type { AgentEventSink } from "../Events/AgentEvent.js";
import { emitAgentEvent } from "../Events/AgentEvent.js";
import { matchByKind } from "../Core/AgentMatch.js";
import type { AgentTurnPreparationSnapshot } from "../Loop/AgentTurnPreparationSnapshot.js";
import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";
import type { AgentSessionAdmissionCoordinator } from "./AgentSessionAdmissionCoordinator.js";
import type { AgentSessionEventFactory } from "./AgentSessionEventFactory.js";
import {
  AgentSessionMessageDispositions,
  type AgentSessionMessageDisposition,
} from "./AgentSessionMessageDisposition.js";
import type { AgentSessionMessageQueueMode } from "./AgentSessionMessageQueueMode.js";
import { AgentSessionOperations } from "./AgentSessionOperation.js";
import type { AgentSessionRunCoordinator } from "./AgentSessionRunCoordinator.js";
import type { AgentSessionStore } from "./AgentSessionStore.js";
import type { AgentExecutionApprovalMode } from "../Safety/AgentExecutionApprovalMode.js";
import type { AgentPinnedSkillReference } from "../Skills/AgentSkillActivation.js";
import type { AgentSystemPromptLayer } from "../Orchestration/AgentRunDispatchPort.js";
import type { AgentConversationEntryMetadata, AgentSessionOwnership } from "../ModelEndpoints/AgentModelMetadata.js";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { AgentSession } from "./AgentSession.js";
import type { AgentInteractionContext } from "../Interaction/AgentInteractionContext.js";

export interface AgentSessionMessageRequest {
  readonly sessionId: string;
  readonly requestId?: string;
  readonly modelProviderId?: string;
  readonly input: string;
  readonly approvalMode: AgentExecutionApprovalMode;
  readonly attachments?: AgentUploadAttachment[];
  readonly disposition?: AgentSessionMessageDisposition;
  readonly queueMode?: AgentSessionMessageQueueMode;
  readonly onEvent?: AgentEventSink;
  readonly preparation?: AgentTurnPreparationSnapshot;
  readonly systemPromptLayer?: AgentSystemPromptLayer;
  readonly allowedToolNames?: readonly string[];
  readonly pinnedSkills?: readonly AgentPinnedSkillReference[];
  readonly thinkingLevel?: ModelThinkingLevel;
  readonly inheritProjectContext?: boolean;
  readonly sessionOwnership?: AgentSessionOwnership;
  readonly metadata?: AgentConversationEntryMetadata;
  /** Runtime surface/platform context visible only to the model wire prompt. */
  readonly interaction?: AgentInteractionContext;
  readonly admissionGuard?: () => boolean;
  /** Internal recovery flag for a durable completion wake only. */
  readonly reclaimRunningCommand?: boolean;
}

export type AgentSessionMessageAcceptanceKind = "accepted" | "queued" | "busy" | "missing" | "superseded";

export interface AgentSessionMessageAcceptance {
  readonly kind: AgentSessionMessageAcceptanceKind;
  readonly completion?: Promise<void>;
}

export interface AgentSessionMessageCoordinatorOptions {
  readonly store: AgentSessionStore;
  readonly admissions: AgentSessionAdmissionCoordinator;
  readonly events: AgentSessionEventFactory;
  readonly runs: AgentSessionRunCoordinator;
  readonly ready: () => Promise<void>;
  readonly recoverHistory: (sessionId: string) => Promise<void>;
}

export class AgentSessionMessageCoordinator {
  constructor(private readonly options: AgentSessionMessageCoordinatorOptions) {}

  /**
   * Runs one message submission to its settled boundary and reports how it was
   * admitted. `queued` means the message joined the active run's turn (no
   * terminal event will reference the request); `busy` means the submission was
   * dropped because the session stayed unavailable across the enqueue retry.
   */
  async submit(request: AgentSessionMessageRequest): Promise<AgentSessionMessageAcceptance> {
    const acceptance = await this.accept(request);
    await acceptance.completion;
    return acceptance;
  }

  accept(request: AgentSessionMessageRequest): Promise<AgentSessionMessageAcceptance> {
    return this.options.admissions.run(request.sessionId, () => this.acceptUnderAdmission(request));
  }

  async acceptUnderAdmission(request: AgentSessionMessageRequest): Promise<AgentSessionMessageAcceptance> {
    let completion: Promise<void> | undefined;
    let kind: AgentSessionMessageAcceptanceKind = "missing";
    await this.options.ready();
    let lookup = this.options.store.get(request.sessionId);
    let opened: ReturnType<AgentSessionStore["open"]> | undefined;
    if (lookup.kind === "missing" && request.disposition === AgentSessionMessageDispositions.CreateIfMissing) {
      opened = this.options.store.open(request.sessionId, request.sessionOwnership);
      lookup = { kind: "found", session: opened.session };
    }

    if (lookup.kind === "found") {
      this.applyRequestChannelMetadata(lookup.session, request.metadata);
    }

    if (opened) {
      await emitAgentEvent(
        request.onEvent,
        matchByKind(opened, {
          created: ({ session }) => this.options.events.created(session),
          existing: ({ session }) => this.options.events.snapshot(session),
        }),
      );
    }

    await matchByKind(lookup, {
      missing: async ({ sessionId }) => {
        kind = "missing";
        await emitAgentEvent(request.onEvent, this.options.events.notFound(sessionId, AgentSessionOperations.Message));
      },
      found: async ({ session }) => {
        await this.options.recoverHistory(session.id);
        if (request.admissionGuard && !request.admissionGuard()) {
          kind = "superseded";
          return;
        }
        const gate = this.options.runs.assertAvailable(session);
        await matchByKind(gate, {
          available: ({ current }) => {
            kind = "accepted";
            completion = this.options.runs.runTurn(current, request);
          },
          busy: async ({ current }) => {
            kind = "busy";
            if (request.queueMode) {
              const queued = await this.options.runs.enqueueActiveRunMessage({
                session: current,
                requestId: request.requestId,
                input: request.input,
                attachments: request.attachments,
                metadata: request.metadata,
                interaction: request.interaction,
                queueMode: request.queueMode,
                onEvent: request.onEvent,
              });
              if (queued) {
                kind = "queued";
                return;
              }

              const refreshed = this.options.runs.assertAvailable(current);
              if (refreshed.kind === "available") {
                kind = "accepted";
                completion = this.options.runs.runTurn(refreshed.current, request);
                return;
              }
            }

            await emitAgentEvent(
              request.onEvent,
              this.options.events.busy(current, AgentSessionOperations.Message, request.requestId),
            );
          },
        });
      },
    });
    return { kind, completion };
  }

  private applyRequestChannelMetadata(session: AgentSession, metadata?: AgentConversationEntryMetadata): void {
    const channel = metadata?.channel;
    if (!channel) return;
    session.metadata = {
      ...session.metadata,
      channel: structuredClone(channel),
    };
    this.options.store.persistMetadata(session);
  }
}
