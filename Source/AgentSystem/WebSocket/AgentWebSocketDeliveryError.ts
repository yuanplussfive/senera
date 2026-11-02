import type { WebSocket } from "ws";
import { AgentBaseError } from "../Core/AgentBaseError.js";

/** A transport failure cannot describe whether the underlying request succeeded. */
export class AgentWebSocketDeliveryError extends AgentBaseError {
  constructor(
    readonly reason: "connection_closed" | "backpressure" | "send_failed",
    options?: ErrorOptions,
  ) {
    super(`WebSocket delivery interrupted: ${reason}.`, options);
  }
}

export function assertAgentWebSocketOpen(socket: WebSocket): void {
  if (socket.readyState !== socket.OPEN) throw new AgentWebSocketDeliveryError("connection_closed");
}
