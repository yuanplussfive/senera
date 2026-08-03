import { AgentEventKinds } from "../Events/AgentEvent.js";
import { AgentLocalizedError } from "../I18n/AgentLocalizedError.js";
import { projectAgentMessage } from "../I18n/AgentMessageProjection.js";
import type { AgentWebSocketRequestOf } from "./AgentWebSocketProtocol.js";
import type { AgentWebSocketEventSender, AgentWebSocketRequestContext } from "./AgentWebSocketTypes.js";

export class AgentWebSocketApprovalRequestHandlers {
  constructor(private readonly context: AgentWebSocketRequestContext) {}

  async resolve(
    request: AgentWebSocketRequestOf<"approval.resolve">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    const approvalRuntime = this.context.approvalRuntime;
    if (!approvalRuntime) throw new AgentLocalizedError("websocket.approvalServiceDisabled");

    const resolution = await approvalRuntime.tryResolve({
      approvalId: request.approvalId,
      decision: request.decision,
      message: request.message,
    });
    if (!resolution) {
      await sendEvent({
        kind: AgentEventKinds.RequestInvalid,
        context: {},
        data: {
          code: "approval_not_pending",
          ...projectAgentMessage("approval.requestNotPending", { approvalId: request.approvalId }),
          details: { approvalId: request.approvalId },
        },
      });
    }
  }
}

export class AgentWebSocketInteractionInputRequestHandlers {
  constructor(private readonly context: AgentWebSocketRequestContext) {}

  async resolve(request: AgentWebSocketRequestOf<"interaction.input.resolve">): Promise<void> {
    const runtime = this.context.interactionInput;
    if (!runtime) throw new AgentLocalizedError("interaction.serviceUnavailable");
    await runtime.resolve({
      interactionId: request.interactionId,
      action: request.action,
      content: request.content,
      message: request.message,
    });
  }
}
