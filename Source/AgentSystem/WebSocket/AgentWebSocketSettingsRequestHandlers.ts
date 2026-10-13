import { AgentEventKinds } from "../Events/AgentEvent.js";
import type { AgentWebSocketRequestOf } from "./AgentWebSocketProtocol.js";
import type { AgentWebSocketEventSender, AgentWebSocketRequestContext } from "./AgentWebSocketTypes.js";

export class AgentWebSocketToolSettingsRequestHandlers {
  constructor(private readonly context: AgentWebSocketRequestContext) {}

  listSystemTools(sendEvent: AgentWebSocketEventSender): Promise<void> {
    const management = this.requireManagement();
    const plugins = this.requirePluginHost().list();
    const snapshot = management.systemSettingsSnapshot();
    return Promise.resolve(
      sendEvent({
        kind: AgentEventKinds.SystemToolSnapshot,
        context: {},
        data: {
          extensions: snapshot.extensions,
          tools: snapshot.tools,
          activation: management.activationCatalog(plugins),
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
    const management = this.requireManagement();
    const plugins = this.requirePluginHost().list();
    const snapshot = management.mcpSettingsSnapshot();
    const activation = management.activationCatalog(plugins);
    return Promise.resolve(
      sendEvent({
        kind: AgentEventKinds.McpServerSnapshot,
        context: {},
        data: {
          servers: snapshot.servers,
          activation,
          ...(requestId ? { operation: { requestId, kind: "mcp_input_update" as const } } : {}),
        },
      }),
    );
  }

  private requireManagement() {
    if (!this.context.mcpManagement) throw new Error("MCP management is unavailable in this runtime.");
    return this.context.mcpManagement;
  }

  private requirePluginHost() {
    if (!this.context.pluginHost) throw new Error("Plugin host is unavailable in this runtime.");
    return this.context.pluginHost;
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
