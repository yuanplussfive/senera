import { AgentEventKinds } from "../Events/AgentEvent.js";
import type { AgentExecutionResourceSnapshot } from "../ExecutionResources/AgentExecutionResourceTypes.js";
import type { AgentWebSocketRequestOf } from "./AgentWebSocketProtocol.js";
import type { AgentWebSocketEventSender, AgentWebSocketRequestContext } from "./AgentWebSocketTypes.js";

export class AgentWebSocketExecutionResourceRequestHandlers {
  constructor(private readonly context: AgentWebSocketRequestContext) {}

  async startTerminal(
    request: AgentWebSocketRequestOf<"execution.resource.start_terminal">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    const runtime = this.context.interactiveTerminals;
    if (!runtime) throw new Error("Interactive terminal creation is unavailable.");
    await this.context.sessionManager.createSession({ sessionId: request.sessionId, onEvent: sendEvent });
    await this.sendSnapshot(
      "start_terminal",
      request.sessionId,
      [
        await runtime.start({
          sessionId: request.sessionId,
          cwd: request.cwd,
          dimensions: { columns: request.columns, rows: request.rows },
        }),
      ],
      sendEvent,
    );
  }

  async list(
    request: AgentWebSocketRequestOf<"execution.resource.list">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    const resources = this.context.executionResources?.list(this.owner(request.sessionId)) ?? [];
    await this.sendSnapshot("list", request.sessionId, resources, sendEvent);
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

  async close(
    request: AgentWebSocketRequestOf<"execution.resource.close">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    const owner = this.owner(request.sessionId);
    await this.broker.release(request.resourceId, owner);
    await this.sendSnapshot("close", request.sessionId, this.broker.list(owner), sendEvent);
  }

  async stopAll(
    request: AgentWebSocketRequestOf<"execution.resource.stop_all">,
    sendEvent: AgentWebSocketEventSender,
  ): Promise<void> {
    await this.sendSnapshot(
      "stop_all",
      request.sessionId,
      await this.broker.stopTerminals(this.owner(request.sessionId)),
      sendEvent,
    );
  }

  private sendSnapshot(
    operation: "start_terminal" | "list" | "inspect" | "write" | "resize" | "signal" | "close" | "stop_all",
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
