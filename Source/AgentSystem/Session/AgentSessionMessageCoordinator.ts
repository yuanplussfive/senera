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

export interface AgentSessionMessageRequest {
  readonly sessionId: string;
  readonly requestId?: string;
  readonly modelProviderId?: string;
  readonly input: string;
  readonly attachments?: AgentUploadAttachment[];
  readonly disposition?: AgentSessionMessageDisposition;
  readonly queueMode?: AgentSessionMessageQueueMode;
  readonly onEvent?: AgentEventSink;
  readonly preparation?: AgentTurnPreparationSnapshot;
}

export interface AgentSessionMessageAcceptance {
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

  async submit(request: AgentSessionMessageRequest): Promise<void> {
    const { completion } = await this.accept(request);
    await completion;
  }

  accept(request: AgentSessionMessageRequest): Promise<AgentSessionMessageAcceptance> {
    return this.options.admissions.run(request.sessionId, () => this.acceptUnderAdmission(request));
  }

  async acceptUnderAdmission(request: AgentSessionMessageRequest): Promise<AgentSessionMessageAcceptance> {
    let completion: Promise<void> | undefined;
    await this.options.ready();
    let lookup = this.options.store.get(request.sessionId);
    if (lookup.kind === "missing" && request.disposition === AgentSessionMessageDispositions.CreateIfMissing) {
      const opened = this.options.store.open(request.sessionId);
      lookup = { kind: "found", session: opened.session };
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
        await emitAgentEvent(request.onEvent, this.options.events.notFound(sessionId, AgentSessionOperations.Message));
      },
      found: async ({ session }) => {
        await this.options.recoverHistory(session.id);
        const gate = this.options.runs.assertAvailable(session);
        await matchByKind(gate, {
          available: ({ current }) => {
            completion = this.options.runs.runTurn(current, request);
          },
          busy: async ({ current }) => {
            if (request.queueMode) {
              const queued = await this.options.runs.enqueueActiveRunMessage({
                session: current,
                requestId: request.requestId,
                input: request.input,
                attachments: request.attachments,
                queueMode: request.queueMode,
                onEvent: request.onEvent,
              });
              if (queued) return;

              const refreshed = this.options.runs.assertAvailable(current);
              if (refreshed.kind === "available") {
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
    return { completion };
  }
}
