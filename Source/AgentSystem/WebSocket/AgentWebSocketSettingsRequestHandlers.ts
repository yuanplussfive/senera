import type { AgentWebSocketRequestOf } from "./AgentWebSocketProtocol.js";
import type { AgentWebSocketEventSender, AgentWebSocketRequestContext } from "./AgentWebSocketTypes.js";
import { AgentEventKinds } from "../Events/AgentEvent.js";
import { findAgentRuntimeDependency } from "../Runtime/AgentRuntimeDependencyCatalog.js";

/** Emits the one canonical MCP settings and activation projection. */
export function sendAgentMcpSettingsSnapshot(
  context: AgentWebSocketRequestContext,
  sendEvent: AgentWebSocketEventSender,
  requestId?: string,
): Promise<void> {
  const management = context.mcpManagement;
  const pluginHost = context.pluginHost;
  if (!management || !pluginHost) throw new Error("MCP management is unavailable in this runtime.");
  const snapshot = management.mcpSettingsSnapshot();
  return Promise.resolve(
    sendEvent({
      kind: AgentEventKinds.McpServerSnapshot,
      context: {},
      data: {
        servers: snapshot.servers,
        activation: management.activationCatalog(pluginHost.list()),
        ...(requestId ? { operation: { requestId, kind: "mcp_input_update" as const } } : {}),
      },
    }),
  );
}

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

  async listRuntimeDependencies(sendEvent: AgentWebSocketEventSender): Promise<void> {
    const service = this.requireRuntimeDependencies();
    const dependencies = await service.list();
    await sendEvent({
      kind: AgentEventKinds.RuntimeDependencySnapshot,
      context: {},
      data: { dependencies, complete: true },
    });
  }

  async checkRuntimeDependency(
    request: AgentWebSocketRequestOf<"runtimeDependency.check">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    const service = this.requireRuntimeDependencies();
    const descriptor = findAgentRuntimeDependency(request.dependencyId);
    if (!descriptor) throw new Error(`Unknown runtime dependency: ${request.dependencyId}`);
    await sendEvent({
      kind: AgentEventKinds.RuntimeDependencySnapshot,
      context: {},
      data: {
        dependencies: [
          {
            ...descriptor,
            status: "checking",
            checkedAt: new Date().toISOString(),
          },
        ],
        complete: false,
      },
    });
    const snapshot = await service.check(request.dependencyId);
    await sendEvent({
      kind: AgentEventKinds.RuntimeDependencySnapshot,
      context: {},
      data: { dependencies: [snapshot], complete: false },
    });
  }

  async installRuntimeDependency(
    request: AgentWebSocketRequestOf<"runtimeDependency.install">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    const service = this.requireRuntimeDependencies();
    await service.install(request.dependencyId, ({ snapshot }) => {
      void sendEvent({
        kind: AgentEventKinds.RuntimeDependencySnapshot,
        context: {},
        data: { dependencies: [snapshot], complete: false },
      });
    });
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
    return sendAgentMcpSettingsSnapshot(this.context, sendEvent, requestId);
  }

  private requireManagement() {
    if (!this.context.mcpManagement) throw new Error("MCP management is unavailable in this runtime.");
    return this.context.mcpManagement;
  }

  private requirePluginHost() {
    if (!this.context.pluginHost) throw new Error("Plugin host is unavailable in this runtime.");
    return this.context.pluginHost;
  }

  private requireRuntimeDependencies() {
    if (!this.context.runtimeDependencies) throw new Error("Runtime dependency management is unavailable.");
    return this.context.runtimeDependencies;
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
