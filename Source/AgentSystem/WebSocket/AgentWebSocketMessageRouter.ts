import { type WebSocket, type RawData } from "ws";
import { AgentEventKinds, type AgentDomainEvent } from "../Events/AgentEvent.js";
import { matchByType } from "../Core/AgentMatch.js";
import { AgentWebSocketRequestSchema, type AgentWebSocketRequest } from "./AgentWebSocketProtocol.js";
import {
  projectAgentWebSocketParseFailure,
  projectAgentWebSocketRequestFailure,
} from "./AgentWebSocketRequestFailures.js";
import {
  AgentWebSocketApprovalRequestHandlers,
  AgentWebSocketInteractionInputRequestHandlers,
} from "./AgentWebSocketInteractionRequestHandlers.js";
import { AgentWebSocketConfigRequestHandlers } from "./AgentWebSocketConfigRequestHandlers.js";
import { AgentWebSocketExecutionResourceRequestHandlers } from "./AgentWebSocketExecutionResourceRequestHandlers.js";
import {
  AgentWebSocketPresetRequestHandlers,
  AgentWebSocketProfileRequestHandlers,
  AgentWebSocketToolSettingsRequestHandlers,
} from "./AgentWebSocketSettingsRequestHandlers.js";
import { AgentWebSocketSandboxRequestHandlers } from "./AgentWebSocketSandboxRequestHandlers.js";
import { AgentWebSocketSessionRequestHandlers } from "./AgentWebSocketSessionRequestHandlers.js";
import type { AgentWebSocketEventSender, AgentWebSocketRequestContext } from "./AgentWebSocketTypes.js";
import type { AgentLocalizedMessage } from "../I18n/AgentMessageCatalog.js";
import { projectAgentErrorMessage, projectAgentMessage } from "../I18n/AgentMessageProjection.js";
import { AgentWebSocketRequestScheduler } from "./AgentWebSocketRequestScheduler.js";
import { parseJsonText } from "../Core/AgentJsonParsing.js";

export class AgentWebSocketMessageRouter {
  private readonly session: AgentWebSocketSessionRequestHandlers;
  private readonly config: AgentWebSocketConfigRequestHandlers;
  private readonly preset: AgentWebSocketPresetRequestHandlers;
  private readonly profile: AgentWebSocketProfileRequestHandlers;
  private readonly approval: AgentWebSocketApprovalRequestHandlers;
  private readonly interactionInput: AgentWebSocketInteractionInputRequestHandlers;
  private readonly sandbox: AgentWebSocketSandboxRequestHandlers;
  private readonly executionResources: AgentWebSocketExecutionResourceRequestHandlers;
  private readonly toolSettings: AgentWebSocketToolSettingsRequestHandlers;
  private readonly scheduler = new AgentWebSocketRequestScheduler();

  constructor(
    private readonly options: {
      context: AgentWebSocketRequestContext;
      sendEnvelope: (socket: WebSocket, event: AgentDomainEvent) => void | Promise<void>;
      broadcast: (event: AgentDomainEvent) => void | Promise<void>;
      flushPersistence?: () => Promise<void>;
    },
  ) {
    this.session = new AgentWebSocketSessionRequestHandlers(options.context);
    this.config = new AgentWebSocketConfigRequestHandlers(options.context, options.broadcast);
    this.preset = new AgentWebSocketPresetRequestHandlers(options.context);
    this.profile = new AgentWebSocketProfileRequestHandlers(options.context);
    this.approval = new AgentWebSocketApprovalRequestHandlers(options.context);
    this.interactionInput = new AgentWebSocketInteractionInputRequestHandlers(options.context);
    this.sandbox = new AgentWebSocketSandboxRequestHandlers(options.context);
    this.executionResources = new AgentWebSocketExecutionResourceRequestHandlers(options.context);
    this.toolSettings = new AgentWebSocketToolSettingsRequestHandlers(options.context);
  }

  async handleMessage(socket: WebSocket, data: RawData): Promise<void> {
    const parsed = this.parseMessage(data);
    if (!parsed.ok) {
      await this.options.sendEnvelope(socket, parsed.event);
      return;
    }

    const sendEvent = (event: AgentDomainEvent): void | Promise<void> => {
      return this.options.sendEnvelope(socket, event);
    };

    try {
      await this.scheduler.run(parsed.request, () => this.dispatch(parsed.request, sendEvent));
      await this.options.flushPersistence?.();
    } catch (error) {
      await sendEvent(projectAgentWebSocketRequestFailure(parsed.request, error, this.options.context));
      await this.recoverOptimisticRequest(parsed.request, sendEvent);
    }
  }

  private async recoverOptimisticRequest(
    request: AgentWebSocketRequest,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    if (request.type !== "session.regenerate") return;
    await this.options.context.sessionManager.replayHistory({
      sessionId: request.sessionId,
      refresh: true,
      onEvent: sendEvent,
    });
  }

  private async dispatch(request: AgentWebSocketRequest, sendEvent: AgentWebSocketEventSender): Promise<void> {
    await matchByType(request, {
      "session.create": (entry) => this.session.create(entry, sendEvent),
      "session.message": (entry) => this.session.message(entry, sendEvent),
      "session.close": (entry) => this.session.close(entry, sendEvent),
      "session.cancel": (entry) => this.session.cancel(entry, sendEvent),
      "session.truncate_from": (entry) => this.session.truncateFrom(entry, sendEvent),
      "session.regenerate": (entry) => this.session.regenerate(entry, sendEvent),
      "session.fork": (entry) => this.session.fork(entry, sendEvent),
      "session.compact": (entry) => this.session.compact(entry, sendEvent),
      "session.runtime_status": (entry) => this.session.runtimeStatus(entry, sendEvent),
      "session.export": (entry) => this.session.export(entry, sendEvent),
      "session.list": () => this.session.list(sendEvent),
      "session.history": (entry) => this.session.history(entry, sendEvent),
      "session.rename": (entry) => this.session.rename(entry, sendEvent),
      "model.list": () => this.config.listModels(sendEvent),
      "provider.models.fetch": (entry) => this.config.fetchProviderModels(entry, sendEvent),
      "config.get": () => this.config.getConfig(sendEvent),
      "systemTool.list": () => this.toolSettings.listSystemTools(sendEvent),
      "mcpServer.list": () => this.toolSettings.listMcpServers(sendEvent),
      "mcpServer.restart": (entry) => this.toolSettings.restart(entry, sendEvent),
      "mcpInput.set": (entry) => this.toolSettings.setInput(entry, sendEvent),
      "mcpInput.delete": (entry) => this.toolSettings.deleteInput(entry, sendEvent),
      "mcpInput.update": (entry) => this.toolSettings.updateInputs(entry, sendEvent),
      "mcpCredential.set": (entry) => this.toolSettings.setCredential(entry, sendEvent),
      "mcpCredential.delete": (entry) => this.toolSettings.deleteCredential(entry, sendEvent),
      "config.update": (entry) => this.config.updateConfig(entry, sendEvent),
      "provider.endpoint.upsert": (entry) => this.config.upsertProviderEndpoint(entry, sendEvent),
      "provider.endpoint.delete": (entry) => this.config.deleteProviderEndpoint(entry, sendEvent),
      "provider.endpoint.rename": (entry) => this.config.renameProviderEndpoint(entry, sendEvent),
      "provider.model.upsert": (entry) => this.config.upsertProviderModel(entry, sendEvent),
      "provider.model.delete": (entry) => this.config.deleteProviderModel(entry, sendEvent),
      "provider.model.bulkImport": (entry) => this.config.bulkImportProviderModels(entry, sendEvent),
      "provider.defaultModel.set": (entry) => this.config.setDefaultProviderModel(entry, sendEvent),
      "preset.list": () => this.preset.list(sendEvent),
      "preset.save": (entry) => this.preset.save(entry, sendEvent),
      "preset.delete": (entry) => this.preset.delete(entry, sendEvent),
      "preset.set_active": (entry) => this.preset.setActive(entry, sendEvent),
      "profile.get": () => this.profile.get(sendEvent),
      "profile.update": (entry) => this.profile.update(entry, sendEvent),
      "approval.resolve": (entry) => this.approval.resolve(entry, sendEvent),
      "interaction.input.resolve": (entry) => this.interactionInput.resolve(entry),
      "sandbox.status": () => this.sandbox.status(sendEvent),
      "execution.resource.list": (entry) => this.executionResources.list(entry, sendEvent),
      "execution.resource.inspect": (entry) => this.executionResources.inspect(entry, sendEvent),
      "execution.resource.write": (entry) => this.executionResources.write(entry, sendEvent),
      "execution.resource.resize": (entry) => this.executionResources.resize(entry, sendEvent),
      "execution.resource.signal": (entry) => this.executionResources.signal(entry, sendEvent),
      "execution.resource.stop_all": (entry) => this.executionResources.stopAll(entry, sendEvent),
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
      rawRequest = parseJsonText(data.toString("utf8"), "WebSocket request body");
    } catch (error) {
      return {
        ok: false,
        event: requestInvalidEvent({
          ...projectAgentErrorMessage(error, "websocket.requestInvalid"),
        }),
      };
    }

    const parsed = AgentWebSocketRequestSchema.safeParse(rawRequest);
    if (parsed.success) {
      return {
        ok: true,
        request: parsed.data,
      };
    }
    const configFailure = projectAgentWebSocketParseFailure(rawRequest, parsed.error.issues, this.options.context);
    return {
      ok: false,
      event:
        configFailure ??
        requestInvalidEvent({
          ...projectAgentMessage("websocket.requestInvalid"),
          details: parsed.error.issues,
        }),
    };
  }
}

function requestInvalidEvent(data: {
  message: string;
  localizedMessage?: AgentLocalizedMessage;
  details?: unknown;
}): AgentDomainEvent {
  return {
    kind: AgentEventKinds.RequestInvalid,
    context: {},
    data: { code: "request_parse_failed", ...data },
  };
}
