import { AgentEventKinds, type AgentDomainEvent } from "../Events/AgentEvent.js";
import { serializeError } from "../Diagnostics/AgentErrorSerializer.js";
import { createRequestId } from "../Core/AgentIds.js";
import type { AgentWebSocketRequest, AgentWebSocketRequestOf } from "./AgentWebSocketProtocol.js";
import type { AgentWebSocketRequestContext } from "./AgentWebSocketTypes.js";

type ConfigMutationRequest =
  | AgentWebSocketRequestOf<"config.update">
  | AgentWebSocketRequestOf<"plugin.config.update">
  | AgentWebSocketRequestOf<"plugin.config.set_enabled">;

type PresetRequest =
  | AgentWebSocketRequestOf<"preset.list">
  | AgentWebSocketRequestOf<"preset.save">
  | AgentWebSocketRequestOf<"preset.delete">
  | AgentWebSocketRequestOf<"preset.set_active">;

const ConfigMutationRequestTypes = {
  "config.update": true,
  "plugin.config.update": true,
  "plugin.config.set_enabled": true,
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

  return projectRunFailure(request, error);
}

function projectConfigFailure(
  request: ConfigMutationRequest,
  error: unknown,
  context: AgentWebSocketRequestContext,
): AgentDomainEvent {
  return {
    kind: AgentEventKinds.ConfigFailed,
    context: {},
    data: {
      configPath:
        request.type === "config.update" ? (context.configService?.snapshot().path ?? "") : request.pluginName,
      message: errorMessage(error),
      details: serializeError(error),
      operation:
        request.type === "config.update"
          ? {
              requestId: request.requestId,
              kind: "config_update",
            }
          : {
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
  const requestId = request.type === "session.message" ? (request.requestId ?? createRequestId()) : createRequestId();
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

function isConfigMutationRequest(request: AgentWebSocketRequest): request is ConfigMutationRequest {
  return request.type in ConfigMutationRequestTypes;
}

function isPresetRequest(request: AgentWebSocketRequest): request is PresetRequest {
  return request.type in PresetOperationKinds;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
