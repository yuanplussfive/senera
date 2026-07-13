import { type WebSocket, type RawData } from "ws";
import { AgentEventKinds, type AgentDomainEvent } from "../Events/AgentEvent.js";
import { matchByType } from "../Core/AgentMatch.js";
import { AgentWebSocketRequestSchema, type AgentWebSocketRequest } from "./AgentWebSocketProtocol.js";
import { projectAgentWebSocketRequestFailure } from "./AgentWebSocketRequestFailures.js";
import {
  AgentWebSocketApprovalRequestHandlers,
  AgentWebSocketConfigRequestHandlers,
  AgentWebSocketPresetRequestHandlers,
  AgentWebSocketProfileRequestHandlers,
  AgentWebSocketSandboxRequestHandlers,
  AgentWebSocketSessionRequestHandlers,
} from "./AgentWebSocketRequestHandlers.js";
import type { AgentWebSocketEventSender, AgentWebSocketRequestContext } from "./AgentWebSocketTypes.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";

export class AgentWebSocketMessageRouter {
  private readonly session: AgentWebSocketSessionRequestHandlers;
  private readonly config: AgentWebSocketConfigRequestHandlers;
  private readonly preset: AgentWebSocketPresetRequestHandlers;
  private readonly profile: AgentWebSocketProfileRequestHandlers;
  private readonly approval: AgentWebSocketApprovalRequestHandlers;
  private readonly sandbox: AgentWebSocketSandboxRequestHandlers;

  constructor(
    private readonly options: {
      context: AgentWebSocketRequestContext;
      sendEnvelope: (socket: WebSocket, event: AgentDomainEvent) => void;
      broadcast: (event: AgentDomainEvent) => void;
    },
  ) {
    this.session = new AgentWebSocketSessionRequestHandlers(options.context);
    this.config = new AgentWebSocketConfigRequestHandlers(options.context, options.broadcast);
    this.preset = new AgentWebSocketPresetRequestHandlers(options.context);
    this.profile = new AgentWebSocketProfileRequestHandlers(options.context);
    this.approval = new AgentWebSocketApprovalRequestHandlers(options.context);
    this.sandbox = new AgentWebSocketSandboxRequestHandlers(options.context);
  }

  async handleMessage(socket: WebSocket, data: RawData): Promise<void> {
    const parsed = this.parseMessage(data);
    if (!parsed.ok) {
      this.options.sendEnvelope(socket, parsed.event);
      return;
    }

    const sendEvent = (event: AgentDomainEvent): void => {
      this.options.sendEnvelope(socket, event);
    };

    try {
      await this.dispatch(parsed.request, sendEvent);
    } catch (error) {
      sendEvent(projectAgentWebSocketRequestFailure(parsed.request, error, this.options.context));
    }
  }

  private async dispatch(request: AgentWebSocketRequest, sendEvent: AgentWebSocketEventSender): Promise<void> {
    await matchByType(request, {
      "session.create": (entry) => this.session.create(entry, sendEvent),
      "session.message": (entry) => this.session.message(entry, sendEvent),
      "session.close": (entry) => this.session.close(entry, sendEvent),
      "session.cancel": (entry) => this.session.cancel(entry, sendEvent),
      "session.truncate_from": (entry) => this.session.truncateFrom(entry, sendEvent),
      "session.list": () => this.session.list(sendEvent),
      "session.history": (entry) => this.session.history(entry, sendEvent),
      "session.rename": (entry) => this.session.rename(entry, sendEvent),
      "model.list": () => this.config.listModels(sendEvent),
      "provider.models.fetch": (entry) => this.config.fetchProviderModels(entry, sendEvent),
      "config.get": () => this.config.getConfig(sendEvent),
      "config.update": (entry) => this.config.updateConfig(entry, sendEvent),
      "provider.endpoint.upsert": (entry) => this.config.upsertProviderEndpoint(entry, sendEvent),
      "provider.endpoint.delete": (entry) => this.config.deleteProviderEndpoint(entry, sendEvent),
      "provider.endpoint.rename": (entry) => this.config.renameProviderEndpoint(entry, sendEvent),
      "provider.model.upsert": (entry) => this.config.upsertProviderModel(entry, sendEvent),
      "provider.model.delete": (entry) => this.config.deleteProviderModel(entry, sendEvent),
      "provider.model.bulkImport": (entry) => this.config.bulkImportProviderModels(entry, sendEvent),
      "provider.defaultModel.set": (entry) => this.config.setDefaultProviderModel(entry, sendEvent),
      "plugin.config.list": () => this.config.listPluginConfig(sendEvent),
      "plugin.config.update": (entry) => this.config.updatePluginConfig(entry, sendEvent),
      "plugin.config.set_enabled": (entry) => this.config.setPluginEnabled(entry, sendEvent),
      "preset.list": () => this.preset.list(sendEvent),
      "preset.save": (entry) => this.preset.save(entry, sendEvent),
      "preset.delete": (entry) => this.preset.delete(entry, sendEvent),
      "preset.set_active": (entry) => this.preset.setActive(entry, sendEvent),
      "profile.get": () => this.profile.get(sendEvent),
      "profile.update": (entry) => this.profile.update(entry, sendEvent),
      "approval.resolve": (entry) => this.approval.resolve(entry, sendEvent),
      "sandbox.status": () => this.sandbox.status(sendEvent),
    });
  }

  private parseMessage(data: RawData):
    | {
        ok: true;
        request: AgentWebSocketRequest;
      }
    | {
        ok: false;
        event: AgentDomainEvent;
      } {
    let rawRequest: unknown;
    try {
      rawRequest = JSON.parse(data.toString("utf8"));
    } catch (error) {
      return {
        ok: false,
        event: requestInvalidEvent({
          message: error instanceof Error ? error.message : String(error),
        }),
      };
    }

    const parsed = AgentWebSocketRequestSchema.safeParse(rawRequest);
    return parsed.success
      ? {
          ok: true,
          request: parsed.data,
        }
      : {
          ok: false,
          event: requestInvalidEvent({
            message: agentErrorMessage("websocket.requestInvalid"),
            details: parsed.error.issues,
          }),
        };
  }
}

function requestInvalidEvent(data: { message: string; details?: unknown }): AgentDomainEvent {
  return {
    kind: AgentEventKinds.RequestInvalid,
    context: {},
    data,
  };
}
