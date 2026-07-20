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
import type { AgentExecutionResourceSnapshot } from "../ExecutionResources/AgentExecutionResourceTypes.js";

export class AgentWebSocketSessionRequestHandlers {
  constructor(private readonly context: AgentWebSocketRequestContext) {}

  async create(
    request: AgentWebSocketRequestOf<"session.create">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.context.sessionManager.createSession({
      sessionId: request.sessionId,
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
      disposition: request.disposition,
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

  async regenerate(
    request: AgentWebSocketRequestOf<"session.regenerate">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.context.sessionManager.regenerateFromRequest({
      sessionId: request.sessionId,
      fromRequestId: request.fromRequestId,
      requestId: request.requestId,
      modelProviderId: request.modelProviderId,
      input: request.input,
      attachments: request.attachments,
      onEvent: sendEvent,
    });
  }

  async fork(request: AgentWebSocketRequestOf<"session.fork">, sendEvent: AgentWebSocketEventSender): Promise<void> {
    await this.context.sessionManager.forkSession({
      sourceSessionId: request.sourceSessionId,
      sessionId: request.sessionId,
      throughRequestId: request.throughRequestId,
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

export class AgentWebSocketExecutionResourceRequestHandlers {
  constructor(private readonly context: AgentWebSocketRequestContext) {}

  async list(request: AgentWebSocketRequestOf<"execution.resource.list">, sendEvent: AgentWebSocketEventSender): Promise<void> {
    await this.sendSnapshot("list", request.sessionId, this.broker.list(this.owner(request.sessionId)), sendEvent);
  }

  async inspect(request: AgentWebSocketRequestOf<"execution.resource.inspect">, sendEvent: AgentWebSocketEventSender): Promise<void> {
    await this.sendSnapshot(
      "inspect",
      request.sessionId,
      [this.broker.inspect(request.resourceId, this.owner(request.sessionId), request.cursor)],
      sendEvent,
    );
  }

  async write(
    request: AgentWebSocketRequestOf<"execution.resource.write">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.sendSnapshot(
      "write",
      request.sessionId,
      [await this.broker.write(request.resourceId, this.owner(request.sessionId), Buffer.from(request.input, "utf8"))],
      sendEvent,
    );
  }

  async resize(
    request: AgentWebSocketRequestOf<"execution.resource.resize">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.sendSnapshot(
      "resize",
      request.sessionId,
      [
        await this.broker.resize(request.resourceId, this.owner(request.sessionId), {
          columns: request.columns,
          rows: request.rows,
        }),
      ],
      sendEvent,
    );
  }

  async signal(
    request: AgentWebSocketRequestOf<"execution.resource.signal">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.sendSnapshot(
      "signal",
      request.sessionId,
      [await this.broker.signal(request.resourceId, this.owner(request.sessionId), request.signal)],
      sendEvent,
    );
  }

  async stopAll(
    request: AgentWebSocketRequestOf<"execution.resource.stop_all">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.sendSnapshot(
      "stop_all",
      request.sessionId,
      await this.broker.stopAll(this.owner(request.sessionId)),
      sendEvent,
    );
  }

  private sendSnapshot(
    operation: "list" | "inspect" | "write" | "resize" | "signal" | "stop_all",
    sessionId: string,
    resources: AgentExecutionResourceSnapshot[],
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    return Promise.resolve(sendEvent({
      kind: AgentEventKinds.ExecutionResourceSnapshot,
      context: { sessionId },
      data: { operation, resources },
    }));
  }

  private owner(sessionId: string) {
    return {
      workspaceRoot: this.context.workspaceRoot,
      sessionId,
    };
  }

  private get broker() {
    const broker = this.context.executionResources;
    if (!broker) throw new Error("Execution resource control is unavailable.");
    return broker;
  }
}

export class AgentWebSocketConfigRequestHandlers {
  constructor(
    private readonly context: AgentWebSocketRequestContext,
    private readonly broadcast: AgentWebSocketEventSender,
  ) {}

  async listModels(sendEvent: AgentWebSocketEventSender): Promise<void> {
    const catalog = resolveModelProviderCatalog(this.context.configSnapshot());
    await sendEvent({
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
      await sendEvent({
        kind: AgentEventKinds.ProviderModelsSnapshot,
        context: {},
        data: await this.context.providerModelDiscovery.listProviderModels({
          providerId: request.providerId,
          force: request.force,
          endpoint: request.endpoint,
        }),
      });
    } catch (error) {
      await sendEvent({
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

  async getConfig(sendEvent: AgentWebSocketEventSender): Promise<void> {
    const snapshot = this.context.configService?.snapshot();
    if (snapshot) {
      await sendEvent({
        kind: AgentEventKinds.ConfigSnapshot,
        context: {},
        data: snapshot,
      });
      return;
    }

    const config = this.context.configSnapshot();
    await sendEvent({
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

  async updateConfig(request: AgentWebSocketRequestOf<"config.update">, sendEvent: AgentWebSocketEventSender): Promise<void> {
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
    await sendEvent({
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
    await this.broadcastConfigReloaded(snapshot);
  }

  upsertProviderEndpoint(
    request: AgentWebSocketRequestOf<"provider.endpoint.upsert">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    return this.sendProviderModelConfigSnapshot(
      this.requireConfigService().upsertProviderEndpoint(request),
      request,
      sendEvent,
    );
  }

  deleteProviderEndpoint(
    request: AgentWebSocketRequestOf<"provider.endpoint.delete">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    return this.sendProviderModelConfigSnapshot(
      this.requireConfigService().deleteProviderEndpoint(request),
      request,
      sendEvent,
    );
  }

  renameProviderEndpoint(
    request: AgentWebSocketRequestOf<"provider.endpoint.rename">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    return this.sendProviderModelConfigSnapshot(
      this.requireConfigService().renameProviderEndpoint(request),
      request,
      sendEvent,
    );
  }

  upsertProviderModel(
    request: AgentWebSocketRequestOf<"provider.model.upsert">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    return this.sendProviderModelConfigSnapshot(this.requireConfigService().upsertProviderModel(request), request, sendEvent);
  }

  deleteProviderModel(
    request: AgentWebSocketRequestOf<"provider.model.delete">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    return this.sendProviderModelConfigSnapshot(this.requireConfigService().deleteProviderModel(request), request, sendEvent);
  }

  bulkImportProviderModels(
    request: AgentWebSocketRequestOf<"provider.model.bulkImport">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    return this.sendProviderModelConfigSnapshot(
      this.requireConfigService().bulkImportProviderModels(request),
      request,
      sendEvent,
    );
  }

  setDefaultProviderModel(
    request: AgentWebSocketRequestOf<"provider.defaultModel.set">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    return this.sendProviderModelConfigSnapshot(
      this.requireConfigService().setDefaultProviderModel(request),
      request,
      sendEvent,
    );
  }

  async listPluginConfig(sendEvent: AgentWebSocketEventSender): Promise<void> {
    await sendEvent({
      kind: AgentEventKinds.PluginConfigSnapshot,
      context: {},
      data: this.context.pluginConfigManager.snapshot(),
    });
  }

  updatePluginConfig(
    request: AgentWebSocketRequestOf<"plugin.config.update">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    return Promise.resolve(sendEvent({
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
    }));
  }

  setPluginEnabled(
    request: AgentWebSocketRequestOf<"plugin.config.set_enabled">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    return Promise.resolve(sendEvent({
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
    }));
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
  ): Promise<void> {
    return (async () => {
      await sendEvent({
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
      await this.broadcastConfigReloaded(snapshot);
    })();
  }

  private broadcastConfigReloaded(
    snapshot: ReturnType<NonNullable<AgentWebSocketRequestContext["configService"]>["snapshot"]>,
  ): Promise<void> {
    return Promise.resolve(this.broadcast({
      kind: AgentEventKinds.ConfigReloaded,
      context: {},
      data: {
        configPath: snapshot.path,
        source: snapshot.source,
        revision: snapshot.revision,
        databasePath: snapshot.databasePath,
        diagnostics: snapshot.diagnostics,
      },
    }));
  }
}

export class AgentWebSocketPresetRequestHandlers {
  constructor(private readonly context: AgentWebSocketRequestContext) {}

  async list(sendEvent: AgentWebSocketEventSender): Promise<void> {
    await sendEvent({
      kind: AgentEventKinds.PresetSnapshot,
      context: {},
      data: await this.context.presetManagerFactory().snapshot({
        kind: "list",
      }),
    });
  }

  async save(request: AgentWebSocketRequestOf<"preset.save">, sendEvent: AgentWebSocketEventSender): Promise<void> {
    await sendEvent({
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
    await sendEvent({
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
    await sendEvent({
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

  async resolve(
    request: AgentWebSocketRequestOf<"approval.resolve">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    const approvalRuntime = this.context.approvalRuntime;
    if (!approvalRuntime) {
      throw new Error(agentErrorMessage("websocket.approvalServiceDisabled"));
    }

    const resolution = await approvalRuntime.tryResolve({
      approvalId: request.approvalId,
      decision: request.decision,
      message: request.message,
    });
    if (!resolution) {
      await sendEvent({
        kind: AgentEventKinds.RequestInvalid,
        context: {},
        data: {
          message: agentErrorMessage("approval.requestNotPending", {
            approvalId: request.approvalId,
          }),
        },
      });
    }
  }
}

export class AgentWebSocketInteractionInputRequestHandlers {
  constructor(private readonly context: AgentWebSocketRequestContext) {}

  async resolve(request: AgentWebSocketRequestOf<"interaction.input.resolve">): Promise<void> {
    const runtime = this.context.interactionInput;
    if (!runtime) throw new Error("Interactive input service is unavailable.");
    await runtime.resolve({
      interactionId: request.interactionId,
      action: request.action,
      content: request.content,
      message: request.message,
    });
  }
}

export class AgentWebSocketSandboxRequestHandlers {
  constructor(private readonly context: AgentWebSocketRequestContext) {}

  async status(sendEvent: AgentWebSocketEventSender): Promise<void> {
    await sendEvent({
      kind: AgentEventKinds.SandboxStatusSnapshot,
      context: {},
      data: this.context.sandboxRuntimeService.snapshot(),
    });
  }
}
