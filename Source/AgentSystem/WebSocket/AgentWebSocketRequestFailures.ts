import { AgentEventKinds, type AgentDomainEvent } from "../Events/AgentEvent.js";
import { serializeError } from "../Diagnostics/AgentErrorSerializer.js";
import { createRequestId } from "../Core/AgentIds.js";
import type { AgentWebSocketRequest, AgentWebSocketRequestOf } from "./AgentWebSocketProtocol.js";
import type { AgentWebSocketRequestContext } from "./AgentWebSocketTypes.js";

type FullConfigUpdateRequest = AgentWebSocketRequestOf<"config.update">;

type ProviderModelConfigMutationRequest =
  | AgentWebSocketRequestOf<"provider.endpoint.upsert">
  | AgentWebSocketRequestOf<"provider.endpoint.delete">
  | AgentWebSocketRequestOf<"provider.endpoint.rename">
  | AgentWebSocketRequestOf<"provider.model.upsert">
  | AgentWebSocketRequestOf<"provider.model.delete">
  | AgentWebSocketRequestOf<"provider.model.bulkImport">
  | AgentWebSocketRequestOf<"provider.defaultModel.set">;

type PluginConfigMutationRequest =
  AgentWebSocketRequestOf<"plugin.config.update"> | AgentWebSocketRequestOf<"plugin.config.set_enabled">;

type ConfigMutationRequest = FullConfigUpdateRequest | ProviderModelConfigMutationRequest | PluginConfigMutationRequest;

type PresetRequest =
  | AgentWebSocketRequestOf<"preset.list">
  | AgentWebSocketRequestOf<"preset.save">
  | AgentWebSocketRequestOf<"preset.delete">
  | AgentWebSocketRequestOf<"preset.set_active">;

const ConfigMutationRequestTypes = {
  "config.update": true,
  "plugin.config.update": true,
  "plugin.config.set_enabled": true,
  "provider.endpoint.upsert": true,
  "provider.endpoint.delete": true,
  "provider.endpoint.rename": true,
  "provider.model.upsert": true,
  "provider.model.delete": true,
  "provider.model.bulkImport": true,
  "provider.defaultModel.set": true,
} as const satisfies Partial<Record<AgentWebSocketRequest["type"], true>>;

const ProviderModelConfigMutationRequestTypes = {
  "provider.endpoint.upsert": true,
  "provider.endpoint.delete": true,
  "provider.endpoint.rename": true,
  "provider.model.upsert": true,
  "provider.model.delete": true,
  "provider.model.bulkImport": true,
  "provider.defaultModel.set": true,
} as const satisfies Partial<Record<AgentWebSocketRequest["type"], true>>;

const PresetOperationKinds = {
  "preset.list": "list",
  "preset.save": "save",
  "preset.delete": "delete",
  "preset.set_active": "set_active",
} as const satisfies Partial<Record<AgentWebSocketRequest["type"], string>>;

export function projectAgentWebSocketRequestFailure(
  request: AgentWebSocketRequest,
  error: unknown,
  context: AgentWebSocketRequestContext,
): AgentDomainEvent {
  if (isConfigMutationRequest(request)) {
    return projectConfigFailure(request, error, context);
  }

  if (isPresetRequest(request)) {
    return projectPresetFailure(request, error);
  }

  if (request.type === "interaction.input.resolve") {
    return {
      kind: AgentEventKinds.RequestInvalid,
      context: {},
      data: {
        message: errorMessage(error),
        details: {
          interactionId: request.interactionId,
          error: serializeError(error),
        },
      },
    };
  }

  return projectRunFailure(request, error);
}

function projectConfigFailure(
  request: ConfigMutationRequest,
  error: unknown,
  context: AgentWebSocketRequestContext,
): AgentDomainEvent {
  if (request.type === "config.update" || isProviderModelConfigMutationRequest(request)) {
    return {
      kind: AgentEventKinds.ConfigFailed,
      context: {},
      data: {
        configPath: context.configService?.snapshot().path ?? "",
        message: errorMessage(error),
        details: serializeError(error),
        operation: {
          commandId: request.commandId,
          kind: request.type === "config.update" ? "config_update" : request.type,
        },
      },
    };
  }

  return {
    kind: AgentEventKinds.ConfigFailed,
    context: {},
    data: {
      configPath: request.pluginName,
      message: errorMessage(error),
      details: serializeError(error),
      operation: {
        requestId: request.requestId,
        kind: request.type === "plugin.config.update" ? "update" : "set_enabled",
        pluginName: request.pluginName,
      },
    },
  };
}

function projectPresetFailure(request: PresetRequest, error: unknown): AgentDomainEvent {
  return {
    kind: AgentEventKinds.PresetFailed,
    context: {},
    data: {
      message: errorMessage(error),
      details: serializeError(error),
      operation: {
        requestId: "requestId" in request ? request.requestId : undefined,
        kind: PresetOperationKinds[request.type],
        name: "name" in request ? (request.name ?? null) : undefined,
      },
    },
  };
}

function projectRunFailure(request: AgentWebSocketRequest, error: unknown): AgentDomainEvent {
  const requestId = readRequestId(request) ?? createRequestId();
  return {
    kind: AgentEventKinds.RunFailed,
    context: {
      requestId,
      sessionId: "sessionId" in request ? request.sessionId : undefined,
    },
    data: {
      message: errorMessage(error),
      details: serializeError(error),
    },
  };
}

function readRequestId(request: AgentWebSocketRequest): string | undefined {
  if (!("requestId" in request)) return undefined;
  return typeof request.requestId === "string" && request.requestId ? request.requestId : undefined;
}

function isConfigMutationRequest(request: AgentWebSocketRequest): request is ConfigMutationRequest {
  return request.type in ConfigMutationRequestTypes;
}

function isProviderModelConfigMutationRequest(
  request: ConfigMutationRequest,
): request is ProviderModelConfigMutationRequest {
  return request.type in ProviderModelConfigMutationRequestTypes;
}

function isPresetRequest(request: AgentWebSocketRequest): request is PresetRequest {
  return request.type in PresetOperationKinds;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
