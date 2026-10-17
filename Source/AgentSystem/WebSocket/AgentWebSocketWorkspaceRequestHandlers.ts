import { AgentEventKinds } from "../Events/AgentEvent.js";
import { serializeError } from "../Diagnostics/AgentErrorSerializer.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import { projectAgentErrorMessage } from "../I18n/AgentMessageProjection.js";
import type { AgentWebSocketRequestOf } from "./AgentWebSocketProtocol.js";
import type { AgentWebSocketEventSender, AgentWebSocketRequestContext } from "./AgentWebSocketTypes.js";

export class AgentWebSocketWorkspaceRequestHandlers {
  constructor(
    private readonly context: Pick<AgentWebSocketRequestContext, "workspaceInfo" | "workspaceSwitchRequest" | "logger">,
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
    await sendEvent({
      kind: AgentEventKinds.WorkspaceSwitchStarted,
      context: {},
      data: { requestId: request.requestId, workspaceRoot: target },
    });
    let result: Awaited<ReturnType<typeof switcher>>;
    try {
      result = await switcher(target);
    } catch (error) {
      await sendEvent({
        kind: AgentEventKinds.WorkspaceSwitchFailed,
        context: {},
        data: {
          requestId: request.requestId,
          workspaceRoot: target,
          ...projectAgentErrorMessage(error, "websocket.workspaceSwitchFailed", { workspaceRoot: target }),
          details: {
            message: errorMessage(error),
            error: serializeError(error),
          },
        },
      });
      return;
    }
    const snapshot = "snapshot" in result ? result.snapshot : result;
    const finalize = "snapshot" in result ? result.finalize : undefined;
    try {
      await sendEvent({
        kind: AgentEventKinds.WorkspaceSwitched,
        context: {},
        data: { ...snapshot, requestId: request.requestId },
      });
    } catch (error) {
      this.context.logger?.warn("工作区切换确认发送失败，将继续回收旧运行时", {
        workspaceRoot: target,
        error: errorMessage(error),
      });
    } finally {
      if (finalize) {
        try {
          await finalize();
        } catch (error) {
          this.context.logger?.error("工作区切换后的旧运行时回收失败", {
            workspaceRoot: target,
            error: errorMessage(error),
          });
        }
      }
    }
  }
}
