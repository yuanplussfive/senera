import { AgentEventKinds, type AgentDomainEvent } from "../Events/AgentEvent.js";
import { serializeError } from "../Diagnostics/AgentErrorSerializer.js";
import { resolveModelProviderCatalog } from "../AgentDefaults.js";
import { projectAgentConfigForm } from "../Config/AgentConfigFormProjector.js";
import {
  assertConfigRevisionGuard,
  type AgentProviderModelConfigOperationKind,
} from "../Config/AgentProviderModelConfigCommands.js";
import type { AgentWebSocketRequestOf } from "./AgentWebSocketProtocol.js";
import type { AgentWebSocketEventSender, AgentWebSocketRequestContext } from "./AgentWebSocketTypes.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";

export class AgentWebSocketSessionRequestHandlers {
  constructor(private readonly context: AgentWebSocketRequestContext) {}

  async create(
    request: AgentWebSocketRequestOf<"session.create">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.context.sessionManager.createSession({
      sessionId: request.sessionId,
      modelProviderId: request.modelProviderId,
      onEvent: sendEvent,
    });
  }

  async message(
    request: AgentWebSocketRequestOf<"session.message">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.context.sessionManager.submitMessage({
      sessionId: request.sessionId,
      requestId: request.requestId,
      modelProviderId: request.modelProviderId,
      input: request.input,
      attachments: request.attachments,
      queueMode: request.queueMode,
      onEvent: sendEvent,
    });
  }

  async close(request: AgentWebSocketRequestOf<"session.close">, sendEvent: AgentWebSocketEventSender): Promise<void> {
    await this.context.sessionManager.closeSession({
      sessionId: request.sessionId,
      onEvent: sendEvent,
    });
  }

  async cancel(
    request: AgentWebSocketRequestOf<"session.cancel">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.context.sessionManager.cancelActiveRun({
      sessionId: request.sessionId,
      onEvent: sendEvent,
    });
  }

  async truncateFrom(
    request: AgentWebSocketRequestOf<"session.truncate_from">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.context.sessionManager.truncateFromRequest({
      sessionId: request.sessionId,
      requestId: request.requestId,
      onEvent: sendEvent,
    });
  }

  async list(sendEvent: AgentWebSocketEventSender): Promise<void> {
    await this.context.sessionManager.emitSessionListSnapshot({
      onEvent: sendEvent,
    });
  }

  async history(
    request: AgentWebSocketRequestOf<"session.history">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.context.sessionManager.replayHistory({
      sessionId: request.sessionId,
      refresh: request.refresh,
      onEvent: sendEvent,
    });
  }

  async rename(
    request: AgentWebSocketRequestOf<"session.rename">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.context.sessionManager.renameSession({
      sessionId: request.sessionId,
      title: request.title,
      onEvent: sendEvent,
    });
  }
}

export class AgentWebSocketConfigRequestHandlers {
  constructor(
    private readonly context: AgentWebSocketRequestContext,
    private readonly broadcast: AgentWebSocketEventSender,
  ) {}

  listModels(sendEvent: AgentWebSocketEventSender): void {
    const catalog = resolveModelProviderCatalog(this.context.configSnapshot());
    sendEvent({
      kind: AgentEventKinds.ModelListSnapshot,
      context: {},
      data: {
        models: catalog.list(),
        defaultModelProviderId: catalog.defaultId,
      },
    } satisfies AgentDomainEvent);
  }

  async fetchProviderModels(
    request: AgentWebSocketRequestOf<"provider.models.fetch">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    try {
      sendEvent({
        kind: AgentEventKinds.ProviderModelsSnapshot,
        context: {},
        data: await this.context.providerModelDiscovery.listProviderModels({
          providerId: request.providerId,
          force: request.force,
          endpoint: request.endpoint,
        }),
      });
    } catch (error) {
      sendEvent({
        kind: AgentEventKinds.ProviderModelsFailed,
        context: {},
        data: {
          providerId: request.providerId,
          message: error instanceof Error ? error.message : String(error),
          details: serializeError(error),
        },
      });
    }
  }

  getConfig(sendEvent: AgentWebSocketEventSender): void {
    const snapshot = this.context.configService?.snapshot();
    if (snapshot) {
      sendEvent({
        kind: AgentEventKinds.ConfigSnapshot,
        context: {},
        data: snapshot,
      });
      return;
    }

    const config = this.context.configSnapshot();
    sendEvent({
      kind: AgentEventKinds.ConfigSnapshot,
      context: {},
      data: {
        path: "",
        version: 1,
        value: config,
        source: "json",
        diagnostics: [],
        form: projectAgentConfigForm(config),
      },
    });
  }

  updateConfig(request: AgentWebSocketRequestOf<"config.update">, sendEvent: AgentWebSocketEventSender): void {
    if (!this.context.configService) {
      throw new Error(agentErrorMessage("websocket.configServiceDisabled"));
    }

    const configService = this.context.configService;
    const current = configService.snapshot();
    if (request.expectedRevision !== undefined || request.expectedVersion !== undefined) {
      assertConfigRevisionGuard(request, {
        revision: current.revision,
        version: current.version,
      });
    }
    const snapshot = configService.update({
      config: request.config,
      source: "ui_update",
      mirrorJson: request.mirrorJson,
    });
    sendEvent({
      kind: AgentEventKinds.ConfigSnapshot,
      context: {},
      data: {
        ...snapshot,
        operation: {
          requestId: request.requestId,
          kind: "config_update",
        },
      },
    });
    this.broadcastConfigReloaded(snapshot);
  }

  upsertProviderEndpoint(
    request: AgentWebSocketRequestOf<"provider.endpoint.upsert">,
    sendEvent: AgentWebSocketEventSender,
  ): void {
    this.sendProviderModelConfigSnapshot(
      this.requireConfigService().upsertProviderEndpoint(request),
      request,
      sendEvent,
    );
  }

  deleteProviderEndpoint(
    request: AgentWebSocketRequestOf<"provider.endpoint.delete">,
    sendEvent: AgentWebSocketEventSender,
  ): void {
    this.sendProviderModelConfigSnapshot(
      this.requireConfigService().deleteProviderEndpoint(request),
      request,
      sendEvent,
    );
  }

  renameProviderEndpoint(
    request: AgentWebSocketRequestOf<"provider.endpoint.rename">,
    sendEvent: AgentWebSocketEventSender,
  ): void {
    this.sendProviderModelConfigSnapshot(
      this.requireConfigService().renameProviderEndpoint(request),
      request,
      sendEvent,
    );
  }

  upsertProviderModel(
    request: AgentWebSocketRequestOf<"provider.model.upsert">,
    sendEvent: AgentWebSocketEventSender,
  ): void {
    this.sendProviderModelConfigSnapshot(this.requireConfigService().upsertProviderModel(request), request, sendEvent);
  }

  deleteProviderModel(
    request: AgentWebSocketRequestOf<"provider.model.delete">,
    sendEvent: AgentWebSocketEventSender,
  ): void {
    this.sendProviderModelConfigSnapshot(this.requireConfigService().deleteProviderModel(request), request, sendEvent);
  }

  bulkImportProviderModels(
    request: AgentWebSocketRequestOf<"provider.model.bulkImport">,
    sendEvent: AgentWebSocketEventSender,
  ): void {
    this.sendProviderModelConfigSnapshot(
      this.requireConfigService().bulkImportProviderModels(request),
      request,
      sendEvent,
    );
  }

  setDefaultProviderModel(
    request: AgentWebSocketRequestOf<"provider.defaultModel.set">,
    sendEvent: AgentWebSocketEventSender,
  ): void {
    this.sendProviderModelConfigSnapshot(
      this.requireConfigService().setDefaultProviderModel(request),
      request,
      sendEvent,
    );
  }

  listPluginConfig(sendEvent: AgentWebSocketEventSender): void {
    sendEvent({
      kind: AgentEventKinds.PluginConfigSnapshot,
      context: {},
      data: this.context.pluginConfigManager.snapshot(),
    });
  }

  updatePluginConfig(
    request: AgentWebSocketRequestOf<"plugin.config.update">,
    sendEvent: AgentWebSocketEventSender,
  ): void {
    sendEvent({
      kind: AgentEventKinds.PluginConfigSnapshot,
      context: {},
      data: {
        ...this.context.pluginConfigManager.updatePluginConfig({
          pluginName: request.pluginName,
          toml: request.toml,
        }),
        operation: {
          requestId: request.requestId,
          kind: "update",
          pluginName: request.pluginName,
        },
      },
    });
  }

  setPluginEnabled(
    request: AgentWebSocketRequestOf<"plugin.config.set_enabled">,
    sendEvent: AgentWebSocketEventSender,
  ): void {
    sendEvent({
      kind: AgentEventKinds.PluginConfigSnapshot,
      context: {},
      data: {
        ...this.context.pluginConfigManager.setPluginEnabled({
          pluginName: request.pluginName,
          toolName: request.toolName,
          enabled: request.enabled,
        }),
        operation: {
          requestId: request.requestId,
          kind: "set_enabled",
          pluginName: request.pluginName,
        },
      },
    });
  }

  private requireConfigService() {
    if (!this.context.configService) {
      throw new Error(agentErrorMessage("websocket.configServiceDisabled"));
    }
    return this.context.configService;
  }

  private sendProviderModelConfigSnapshot(
    snapshot: ReturnType<NonNullable<AgentWebSocketRequestContext["configService"]>["snapshot"]>,
    request: {
      requestId?: string;
      type: AgentProviderModelConfigOperationKind;
    },
    sendEvent: AgentWebSocketEventSender,
  ): void {
    sendEvent({
      kind: AgentEventKinds.ConfigSnapshot,
      context: {},
      data: {
        ...snapshot,
        operation: {
          requestId: request.requestId,
          kind: request.type,
        },
      },
    });
    this.broadcastConfigReloaded(snapshot);
  }

  private broadcastConfigReloaded(
    snapshot: ReturnType<NonNullable<AgentWebSocketRequestContext["configService"]>["snapshot"]>,
  ): void {
    this.broadcast({
      kind: AgentEventKinds.ConfigReloaded,
      context: {},
      data: {
        configPath: snapshot.path,
        source: snapshot.source,
        revision: snapshot.revision,
        databasePath: snapshot.databasePath,
        diagnostics: snapshot.diagnostics,
      },
    });
  }
}

export class AgentWebSocketPresetRequestHandlers {
  constructor(private readonly context: AgentWebSocketRequestContext) {}

  async list(sendEvent: AgentWebSocketEventSender): Promise<void> {
    sendEvent({
      kind: AgentEventKinds.PresetSnapshot,
      context: {},
      data: await this.context.presetManagerFactory().snapshot({
        kind: "list",
      }),
    });
  }

  async save(request: AgentWebSocketRequestOf<"preset.save">, sendEvent: AgentWebSocketEventSender): Promise<void> {
    sendEvent({
      kind: AgentEventKinds.PresetSnapshot,
      context: {},
      data: await this.context.presetManagerFactory().save({
        requestId: request.requestId,
        name: request.name,
        format: request.format,
        content: request.content,
        activate: request.activate,
      }),
    });
  }

  async delete(request: AgentWebSocketRequestOf<"preset.delete">, sendEvent: AgentWebSocketEventSender): Promise<void> {
    sendEvent({
      kind: AgentEventKinds.PresetSnapshot,
      context: {},
      data: await this.context.presetManagerFactory().delete({
        requestId: request.requestId,
        name: request.name,
      }),
    });
  }

  async setActive(
    request: AgentWebSocketRequestOf<"preset.set_active">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    sendEvent({
      kind: AgentEventKinds.PresetSnapshot,
      context: {},
      data: await this.context.presetManagerFactory().setActive({
        requestId: request.requestId,
        name: request.name,
      }),
    });
  }
}

export class AgentWebSocketProfileRequestHandlers {
  constructor(private readonly context: AgentWebSocketRequestContext) {}

  async get(sendEvent: AgentWebSocketEventSender): Promise<void> {
    await this.context.userProfileManager.emitSnapshot({
      onEvent: sendEvent,
    });
  }

  async update(
    request: AgentWebSocketRequestOf<"profile.update">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.context.userProfileManager.updateProfile({
      profile: request.profile,
      onEvent: sendEvent,
    });
  }
}

export class AgentWebSocketApprovalRequestHandlers {
  constructor(private readonly context: AgentWebSocketRequestContext) {}

  resolve(request: AgentWebSocketRequestOf<"approval.resolve">, sendEvent: AgentWebSocketEventSender): void {
    const approvalRuntime = this.context.approvalRuntime;
    if (!approvalRuntime) {
      throw new Error(agentErrorMessage("websocket.approvalServiceDisabled"));
    }

    const pending = approvalRuntime.getPending(request.approvalId);
    if (!pending) {
      sendEvent({
        kind: AgentEventKinds.RequestInvalid,
        context: {},
        data: {
          message: agentErrorMessage("approval.requestNotPending", {
            approvalId: request.approvalId,
          }),
        },
      });
      return;
    }

    const resolution = approvalRuntime.tryResolve({
      approvalId: request.approvalId,
      status: request.status,
      message: request.message,
      scope: request.scope,
    });
    if (!resolution) {
      sendEvent({
        kind: AgentEventKinds.RequestInvalid,
        context: {},
        data: {
          message: agentErrorMessage("approval.requestNotPending", {
            approvalId: request.approvalId,
          }),
        },
      });
      return;
    }

    sendEvent({
      kind: AgentEventKinds.ApprovalResolved,
      context: {
        requestId: pending.requestId,
        step: pending.step,
      },
      data: {
        approvalId: pending.approvalId,
        approvalKind: pending.kind,
        title: pending.title,
        reason: pending.reason,
        rule: pending.rule,
        riskSignals: pending.riskSignals,
        subject: pending.subject,
        createdAt: pending.createdAt,
        status: resolution.status,
        message: resolution.message,
        scope: resolution.scope,
        resolvedAt: resolution.resolvedAt,
      },
    });
  }
}

export class AgentWebSocketSandboxRequestHandlers {
  constructor(private readonly context: AgentWebSocketRequestContext) {}

  status(sendEvent: AgentWebSocketEventSender): void {
    sendEvent({
      kind: AgentEventKinds.SandboxStatusSnapshot,
      context: {},
      data: this.context.sandboxRuntimeService.snapshot(),
    });
  }
}
