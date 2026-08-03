import { AgentEventKinds } from "../Events/AgentEvent.js";
import type { AgentWebSocketRequestOf } from "./AgentWebSocketProtocol.js";
import type { AgentWebSocketEventSender, AgentWebSocketRequestContext } from "./AgentWebSocketTypes.js";

export class AgentWebSocketToolSettingsRequestHandlers {
  constructor(private readonly context: AgentWebSocketRequestContext) {}

  listSystemTools(sendEvent: AgentWebSocketEventSender): Promise<void> {
    const snapshot = this.requireManagement().systemSettingsSnapshot();
    return Promise.resolve(
      sendEvent({
        kind: AgentEventKinds.SystemToolSnapshot,
        context: {},
        data: {
          extensions: snapshot.extensions,
          tools: snapshot.tools,
        },
      }),
    );
  }

  listMcpServers(sendEvent: AgentWebSocketEventSender): Promise<void> {
    return this.sendMcpSnapshot(sendEvent);
  }

  setCredential(
    request: AgentWebSocketRequestOf<"mcpCredential.set">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    this.requireManagement().setCredential(request.serverId, request.name, request.value);
    return this.sendMcpSnapshot(sendEvent);
  }

  setInput(request: AgentWebSocketRequestOf<"mcpInput.set">, sendEvent: AgentWebSocketEventSender): Promise<void> {
    this.requireManagement().setInput(request.serverId, request.inputId, request.value);
    return this.sendMcpSnapshot(sendEvent);
  }

  deleteInput(
    request: AgentWebSocketRequestOf<"mcpInput.delete">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    this.requireManagement().deleteInput(request.serverId, request.inputId);
    return this.sendMcpSnapshot(sendEvent);
  }

  updateInputs(
    request: AgentWebSocketRequestOf<"mcpInput.update">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    this.requireManagement().updateInputs(request.serverId, request.values, request.deletes);
    return this.sendMcpSnapshot(sendEvent, request.requestId);
  }

  deleteCredential(
    request: AgentWebSocketRequestOf<"mcpCredential.delete">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    this.requireManagement().deleteCredential(request.serverId, request.name);
    return this.sendMcpSnapshot(sendEvent);
  }

  restart(request: AgentWebSocketRequestOf<"mcpServer.restart">, sendEvent: AgentWebSocketEventSender): Promise<void> {
    this.requireManagement().restart(request.serverId);
    return this.sendMcpSnapshot(sendEvent);
  }

  private sendMcpSnapshot(sendEvent: AgentWebSocketEventSender, requestId?: string): Promise<void> {
    const snapshot = this.requireManagement().mcpSettingsSnapshot();
    return Promise.resolve(
      sendEvent({
        kind: AgentEventKinds.McpServerSnapshot,
        context: {},
        data: {
          servers: snapshot.servers,
          ...(requestId ? { operation: { requestId, kind: "mcp_input_update" as const } } : {}),
        },
      }),
    );
  }

  private requireManagement() {
    if (!this.context.mcpManagement) throw new Error("MCP management is unavailable in this runtime.");
    return this.context.mcpManagement;
  }
}

export class AgentWebSocketPresetRequestHandlers {
  constructor(private readonly context: AgentWebSocketRequestContext) {}

  async list(sendEvent: AgentWebSocketEventSender): Promise<void> {
    await sendEvent({
      kind: AgentEventKinds.PresetSnapshot,
      context: {},
      data: await this.context.presetManagerFactory().snapshot({ kind: "list" }),
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
    await this.context.userProfileManager.emitSnapshot({ onEvent: sendEvent });
  }

  async update(
    request: AgentWebSocketRequestOf<"profile.update">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.context.userProfileManager.updateProfile({ profile: request.profile, onEvent: sendEvent });
  }
}
