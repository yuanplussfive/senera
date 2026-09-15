import { AgentEventKinds } from "../Events/AgentEvent.js";
import type { AgentWebSocketEventSender, AgentWebSocketRequestContext } from "./AgentWebSocketTypes.js";

export class AgentWebSocketSandboxRequestHandlers {
  constructor(private readonly context: AgentWebSocketRequestContext) {}

  async status(sendEvent: AgentWebSocketEventSender): Promise<void> {
    await sendEvent({
      kind: AgentEventKinds.SandboxStatusSnapshot,
      context: {},
      data: this.context.sandboxRuntimeService.snapshot(),
    });
  }
}
