import { resolveModelProviderCatalog } from "../AgentDefaults.js";
import { projectAgentConfigForm } from "../Config/AgentConfigFormProjector.js";
import type { AgentProviderModelConfigOperationKind } from "../Config/AgentProviderModelConfigCommands.js";
import {
  redactAgentConfigSnapshotSecrets,
  redactAgentSystemConfigSecrets,
  restoreAgentProviderEndpointSecrets,
  restoreAgentSystemConfigSecrets,
} from "../Config/AgentConfigSecretRedaction.js";
import { serializeError } from "../Diagnostics/AgentErrorSerializer.js";
import { AgentEventKinds, type AgentDomainEvent } from "../Events/AgentEvent.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import { projectAgentErrorMessage } from "../I18n/AgentMessageProjection.js";
import type { AgentWebSocketRequestOf } from "./AgentWebSocketProtocol.js";
import type { AgentWebSocketEventSender, AgentWebSocketRequestContext } from "./AgentWebSocketTypes.js";

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
      data: { models: catalog.list(), defaultModelProviderId: catalog.defaultId },
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
          endpoint: request.endpoint
            ? restoreAgentProviderEndpointSecrets(
                request.endpoint,
                this.currentConfigValue().ModelProviderEndpoints ?? [],
              )
            : undefined,
        }),
      });
    } catch (error) {
      await sendEvent({
        kind: AgentEventKinds.ProviderModelsFailed,
        context: {},
        data: {
          providerId: request.providerId,
          ...projectAgentErrorMessage(error, "model.listFailed"),
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
        data: redactAgentConfigSnapshotSecrets(snapshot),
      });
      return;
    }

    const config = redactAgentSystemConfigSecrets(this.context.configSnapshot());
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

  async updateConfig(
    request: AgentWebSocketRequestOf<"config.update">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    const service = this.requireConfigService();
    const config = restoreAgentSystemConfigSecrets(request.config, service.snapshot().value);
    this.context.mcpManagement?.validateSystemExtensions(config);
    const snapshot = service.replaceConfig({
      commandId: request.commandId,
      baseRevision: request.baseRevision,
      baseVersion: request.baseVersion,
      config,
      source: "ui_update",
    });
    await sendEvent({
      kind: AgentEventKinds.ConfigSnapshot,
      context: {},
      data: {
        ...redactAgentConfigSnapshotSecrets(snapshot),
        operation: { commandId: request.commandId, kind: "config_update" },
      },
    });
    await this.broadcastConfigReloaded(snapshot);
  }

  upsertProviderEndpoint(
    request: AgentWebSocketRequestOf<"provider.endpoint.upsert">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    const service = this.requireConfigService();
    return this.sendProviderModelConfigSnapshot(
      service.upsertProviderEndpoint({
        ...request,
        endpoint: restoreAgentProviderEndpointSecrets(
          request.endpoint,
          service.snapshot().value.ModelProviderEndpoints ?? [],
        ),
      }),
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
    return this.sendProviderModelConfigSnapshot(
      this.requireConfigService().upsertProviderModel(request),
      request,
      sendEvent,
    );
  }

  deleteProviderModel(
    request: AgentWebSocketRequestOf<"provider.model.delete">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    return this.sendProviderModelConfigSnapshot(
      this.requireConfigService().deleteProviderModel(request),
      request,
      sendEvent,
    );
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

  private requireConfigService() {
    if (!this.context.configService) throw new AgentLocalizedError("websocket.configServiceDisabled");
    return this.context.configService;
  }

  private currentConfigValue() {
    return this.context.configService?.snapshot().value ?? this.context.configSnapshot();
  }

  private sendProviderModelConfigSnapshot(
    snapshot: ReturnType<NonNullable<AgentWebSocketRequestContext["configService"]>["snapshot"]>,
    request: { commandId: string; type: AgentProviderModelConfigOperationKind },
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    return (async () => {
      await sendEvent({
        kind: AgentEventKinds.ConfigSnapshot,
        context: {},
        data: {
          ...redactAgentConfigSnapshotSecrets(snapshot),
          operation: { commandId: request.commandId, kind: request.type },
        },
      });
      await this.broadcastConfigReloaded(snapshot);
    })();
  }

  private broadcastConfigReloaded(
    snapshot: ReturnType<NonNullable<AgentWebSocketRequestContext["configService"]>["snapshot"]>,
  ): Promise<void> {
    return Promise.resolve(
      this.broadcast({
        kind: AgentEventKinds.ConfigReloaded,
        context: {},
        data: {
          configPath: snapshot.path,
          source: snapshot.source,
          revision: snapshot.revision,
          diagnostics: snapshot.diagnostics,
        },
      }),
    );
  }
}
