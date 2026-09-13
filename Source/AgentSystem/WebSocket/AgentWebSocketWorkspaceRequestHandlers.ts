import { AgentEventKinds } from "../Events/AgentEvent.js";
import { serializeError } from "../Diagnostics/AgentErrorSerializer.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import { projectAgentErrorMessage } from "../I18n/AgentMessageProjection.js";
import type { AgentWebSocketRequestOf } from "./AgentWebSocketProtocol.js";
import type { AgentWebSocketEventSender, AgentWebSocketRequestContext } from "./AgentWebSocketTypes.js";

export class AgentWebSocketWorkspaceRequestHandlers {
  constructor(
    private readonly context: AgentWebSocketRequestContext,
    private readonly broadcast: AgentWebSocketEventSender,
  ) {}

  async get(_request: AgentWebSocketRequestOf<"workspace.get">, sendEvent: AgentWebSocketEventSender): Promise<void> {
    if (!this.context.workspaceInfo) throw new AgentLocalizedError("websocket.workspaceSwitchUnavailable");
    await sendEvent({
      kind: AgentEventKinds.WorkspaceSnapshot,
      context: {},
      data: this.context.workspaceInfo(),
    });
  }

  async switch(
    request: AgentWebSocketRequestOf<"workspace.switch">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    const switcher = this.context.workspaceSwitchRequest;
    if (!switcher) throw new AgentLocalizedError("websocket.workspaceSwitchUnavailable");
    const target = request.workspaceRoot;
    await this.broadcast({
      kind: AgentEventKinds.WorkspaceSwitchStarted,
      context: {},
      data: { workspaceRoot: target },
    });
    try {
      const snapshot = await switcher(target);
      // The old server stack is already torn down by the time the switch
      // resolves; the client reconnects and pulls the new snapshot via
      // workspace.get. The reply here is best-effort for sockets still open.
      await sendEvent({
        kind: AgentEventKinds.WorkspaceSwitched,
        context: {},
        data: snapshot,
      });
    } catch (error) {
      await sendEvent({
        kind: AgentEventKinds.WorkspaceSwitchFailed,
        context: {},
        data: {
          workspaceRoot: target,
          ...projectAgentErrorMessage(error, "websocket.workspaceSwitchFailed", { workspaceRoot: target }),
          details: {
            message: errorMessage(error),
            error: serializeError(error),
          },
        },
      });
    }
  }
}
