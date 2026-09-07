import { AgentEventKinds } from "../Events/AgentEvent.js";
import type { AgentWebSocketRequestOf } from "./AgentWebSocketProtocol.js";
import type { AgentChannelServiceControl, AgentWebSocketEventSender } from "./AgentWebSocketTypes.js";

export class AgentWebSocketChannelRequestHandlers {
  constructor(private readonly channel: AgentChannelServiceControl) {}

  async connect(
    request: AgentWebSocketRequestOf<"channel.connect">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.channel.connectChannel(request.kind);
    await sendEvent({
      kind: AgentEventKinds.ChannelStatusSnapshot,
      context: {},
      data: { statuses: this.channel.statuses },
    });
  }
}
