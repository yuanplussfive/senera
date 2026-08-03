import { AgentEventKinds } from "../Events/AgentEvent.js";
import type { AgentExecutionResourceSnapshot } from "../ExecutionResources/AgentExecutionResourceTypes.js";
import type { AgentWebSocketRequestOf } from "./AgentWebSocketProtocol.js";
import type { AgentWebSocketEventSender, AgentWebSocketRequestContext } from "./AgentWebSocketTypes.js";

export class AgentWebSocketExecutionResourceRequestHandlers {
  constructor(private readonly context: AgentWebSocketRequestContext) {}

  async list(
    request: AgentWebSocketRequestOf<"execution.resource.list">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.sendSnapshot("list", request.sessionId, this.broker.list(this.owner(request.sessionId)), sendEvent);
  }

  async inspect(
    request: AgentWebSocketRequestOf<"execution.resource.inspect">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.sendSnapshot(
      "inspect",
      request.sessionId,
      [this.broker.inspect(request.resourceId, this.owner(request.sessionId), request.cursor)],
      sendEvent,
    );
  }

  async write(
    request: AgentWebSocketRequestOf<"execution.resource.write">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.sendSnapshot(
      "write",
      request.sessionId,
      [await this.broker.write(request.resourceId, this.owner(request.sessionId), Buffer.from(request.input, "utf8"))],
      sendEvent,
    );
  }

  async resize(
    request: AgentWebSocketRequestOf<"execution.resource.resize">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.sendSnapshot(
      "resize",
      request.sessionId,
      [
        await this.broker.resize(request.resourceId, this.owner(request.sessionId), {
          columns: request.columns,
          rows: request.rows,
        }),
      ],
      sendEvent,
    );
  }

  async signal(
    request: AgentWebSocketRequestOf<"execution.resource.signal">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.sendSnapshot(
      "signal",
      request.sessionId,
      [await this.broker.signal(request.resourceId, this.owner(request.sessionId), request.signal)],
      sendEvent,
    );
  }

  async stopAll(
    request: AgentWebSocketRequestOf<"execution.resource.stop_all">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.sendSnapshot(
      "stop_all",
      request.sessionId,
      await this.broker.stopAll(this.owner(request.sessionId)),
      sendEvent,
    );
  }

  private sendSnapshot(
    operation: "list" | "inspect" | "write" | "resize" | "signal" | "stop_all",
    sessionId: string,
    resources: AgentExecutionResourceSnapshot[],
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    return Promise.resolve(
      sendEvent({
        kind: AgentEventKinds.ExecutionResourceSnapshot,
        context: { sessionId },
        data: { operation, resources },
      }),
    );
  }

  private owner(sessionId: string) {
    return { workspaceRoot: this.context.workspaceRoot, sessionId };
  }

  private get broker() {
    const broker = this.context.executionResources;
    if (!broker) throw new Error("Execution resource control is unavailable.");
    return broker;
  }
}
