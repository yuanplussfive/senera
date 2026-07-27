import { AgentEventKinds, type AgentDomainEvent } from "../Events/AgentEvent.js";
import { serializeError } from "../Diagnostics/AgentErrorSerializer.js";
import { createRequestId } from "../Core/AgentIds.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import type { AgentSystemConfigOperationKind } from "../Config/AgentConfigEventTypes.js";
import type { AgentWebSocketRequest, AgentWebSocketRequestOf } from "./AgentWebSocketProtocol.js";
import type { AgentWebSocketRequestContext } from "./AgentWebSocketTypes.js";
import { errorMessage } from "../Core/AgentErrors.js";

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

/**
 * Maps a schema-parse failure back onto the originating config command when the
 * raw payload still carries an identifiable `type` + `commandId`. Without this,
 * the frontend command queue would never release its in-flight slot, because
 * `RequestInvalid` events carry no operation identity.
 */
const ParseFailureOperationKinds: Partial<Record<string, AgentSystemConfigOperationKind>> = {
  "config.update": "config_update",
  "provider.endpoint.upsert": "provider.endpoint.upsert",
  "provider.endpoint.delete": "provider.endpoint.delete",
  "provider.endpoint.rename": "provider.endpoint.rename",
  "provider.model.upsert": "provider.model.upsert",
  "provider.model.delete": "provider.model.delete",
  "provider.model.bulkImport": "provider.model.bulkImport",
  "provider.defaultModel.set": "provider.defaultModel.set",
};

export function projectAgentWebSocketParseFailure(
  rawRequest: unknown,
  issues: unknown,
  context: AgentWebSocketRequestContext,
): AgentDomainEvent | null {
  if (typeof rawRequest !== "object" || rawRequest === null || Array.isArray(rawRequest)) return null;
  const record = rawRequest as Record<string, unknown>;
  const type = record.type;
  const commandId = record.commandId;
  if (typeof type !== "string" || typeof commandId !== "string" || !commandId) return null;
  const operationKind = ParseFailureOperationKinds[type];
  if (!operationKind) return null;
  return {
    kind: AgentEventKinds.ConfigFailed,
    context: {},
    data: {
      configPath: context.configService?.snapshot().path ?? "",
      message: agentErrorMessage("websocket.requestInvalid"),
      details: { issues },
      operation: {
        commandId,
        kind: operationKind,
      },
    },
  };
}

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
        code: "interaction_input_resolve_failed",
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
