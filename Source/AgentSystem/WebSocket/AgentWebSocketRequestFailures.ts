import { AgentEventKinds, type AgentDomainEvent } from "../Events/AgentEvent.js";
import { serializeError } from "../Diagnostics/AgentErrorSerializer.js";
import { createRequestId } from "../Core/AgentIds.js";
import { projectAgentErrorMessage, projectAgentMessage } from "../I18n/AgentMessageProjection.js";
import type { AgentSystemConfigOperationKind } from "../Config/AgentConfigEventTypes.js";
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

type ConfigMutationRequest = FullConfigUpdateRequest | ProviderModelConfigMutationRequest;

type PresetRequest =
  | AgentWebSocketRequestOf<"preset.list">
  | AgentWebSocketRequestOf<"preset.save">
  | AgentWebSocketRequestOf<"preset.delete">
  | AgentWebSocketRequestOf<"preset.set_active">;

type ToolSettingsRequest =
  | AgentWebSocketRequestOf<"systemTool.list">
  | AgentWebSocketRequestOf<"mcpServer.list">
  | AgentWebSocketRequestOf<"mcpServer.restart">
  | AgentWebSocketRequestOf<"mcpInput.set">
  | AgentWebSocketRequestOf<"mcpInput.delete">
  | AgentWebSocketRequestOf<"mcpInput.update">
  | AgentWebSocketRequestOf<"mcpCredential.set">
  | AgentWebSocketRequestOf<"mcpCredential.delete">;

const ConfigMutationRequestTypes = {
  "config.update": true,
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

const ToolSettingsRequestTypes = {
  "systemTool.list": true,
  "mcpServer.list": true,
  "mcpServer.restart": true,
  "mcpInput.set": true,
  "mcpInput.delete": true,
  "mcpInput.update": true,
  "mcpCredential.set": true,
  "mcpCredential.delete": true,
} as const satisfies Partial<Record<AgentWebSocketRequest["type"], true>>;

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
      ...projectAgentMessage("websocket.requestInvalid"),
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
  context?: AgentWebSocketRequestContext,
): AgentDomainEvent {
  if (isConfigMutationRequest(request)) {
    return projectConfigFailure(request, error, context);
  }

  if (isPresetRequest(request)) {
    return projectPresetFailure(request, error);
  }

  if (isToolSettingsRequest(request)) {
    return projectToolSettingsFailure(request, error);
  }

  if (request.type === "interaction.input.resolve") {
    return {
      kind: AgentEventKinds.RequestInvalid,
      context: {},
      data: {
        code: "interaction_input_resolve_failed",
        ...projectAgentErrorMessage(error, "interaction.inputResolveFailed"),
        details: {
          interactionId: request.interactionId,
          error: serializeError(error),
        },
      },
    };
  }

  return projectRunFailure(request, error);
}

function projectToolSettingsFailure(request: ToolSettingsRequest, error: unknown): AgentDomainEvent {
  return {
    kind: AgentEventKinds.RequestInvalid,
    context: {},
    data: {
      code: "tool_settings_request_failed",
      ...projectAgentErrorMessage(error, "tool.settingsRequestFailed"),
      details: {
        requestType: request.type,
        ...("serverId" in request ? { serverId: request.serverId } : {}),
        ...("name" in request ? { name: request.name } : {}),
        ...("inputId" in request ? { inputId: request.inputId } : {}),
        ...("requestId" in request ? { requestId: request.requestId } : {}),
        error: serializeError(error),
      },
    },
  };
}

function projectConfigFailure(
  request: ConfigMutationRequest,
  error: unknown,
  context?: AgentWebSocketRequestContext,
): AgentDomainEvent {
  return {
    kind: AgentEventKinds.ConfigFailed,
    context: {},
    data: {
      configPath: context?.configService?.snapshot().path ?? "",
      ...projectAgentErrorMessage(error, "config.operationFailed"),
      details: serializeError(error),
      operation: {
        commandId: request.commandId,
        kind: request.type === "config.update" ? "config_update" : request.type,
      },
    },
  };
}

function projectPresetFailure(request: PresetRequest, error: unknown): AgentDomainEvent {
  return {
    kind: AgentEventKinds.PresetFailed,
    context: {},
    data: {
      ...projectAgentErrorMessage(error, "preset.operationFailed"),
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
      ...projectAgentErrorMessage(error, "session.runFailed"),
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

function isPresetRequest(request: AgentWebSocketRequest): request is PresetRequest {
  return request.type in PresetOperationKinds;
}

function isToolSettingsRequest(request: AgentWebSocketRequest): request is ToolSettingsRequest {
  return request.type in ToolSettingsRequestTypes;
}
