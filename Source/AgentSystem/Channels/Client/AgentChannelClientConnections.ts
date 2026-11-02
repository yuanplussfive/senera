import { WebSocket } from "ws";
import type { AgentAuthenticatedAccess, AgentServerAccessGuard } from "../../Auth/AgentServerAccessGuard.js";

/** Workspace ownership and host-session lifetime for channel protocol sockets. */
export class AgentChannelClientConnections {
  private readonly connections = new Set<WebSocket>();

  constructor(
    private readonly guard: AgentServerAccessGuard,
    private readonly onChanged: () => void,
  ) {}

  get clientCount(): number {
    return this.connections.size;
  }

  add(socket: WebSocket, access: AgentAuthenticatedAccess): void {
    this.connections.add(socket);
    this.guard.registerConnection(socket, access);
    socket.on("pong", () => this.guard.recordPong(socket));
    socket.once("close", () => {
      this.connections.delete(socket);
      this.guard.unregisterConnection(socket);
      this.onChanged();
    });
    socket.on("error", () => socket.terminate());
    this.onChanged();
  }

  heartbeat(): void {
    for (const socket of this.connections) {
      const failure = this.guard.connectionFailure(socket);
      if (failure) socket.close(failure.code, failure.reason);
      else if (socket.readyState === WebSocket.OPEN) socket.ping();
    }
  }

  close(): void {
    for (const socket of this.connections) socket.terminate();
  }
}
