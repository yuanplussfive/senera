import { WebSocket, WebSocketServer } from "ws";
import type { AgentServerAccessGuard } from "../Auth/AgentServerAccessGuard.js";
import { AgentWebSocketCloseCodes } from "./AgentWebSocketCloseContract.js";

/** Authorize before protocol listeners receive a frame, including after session revocation. */
export function createAgentChannelWebSocketServer(guard: AgentServerAccessGuard, maxPayload: number): WebSocketServer {
  class AuthenticatedChannelSocket extends WebSocket {
    override emit(event: string | symbol, ...args: unknown[]): boolean {
      if (event === "message") {
        const authorization = guard.authorizeMessage(this);
        if (!authorization.ok) {
          const code =
            authorization.failure.code === "authentication_required"
              ? AgentWebSocketCloseCodes.AuthenticationRequired
              : authorization.failure.code === "forbidden_origin"
                ? AgentWebSocketCloseCodes.AccessForbidden
                : 1013;
          this.close(code, authorization.failure.code);
          return false;
        }
      }
      return super.emit(event, ...args);
    }
  }

  return new WebSocketServer({
    noServer: true,
    maxPayload,
    perMessageDeflate: false,
    WebSocket: AuthenticatedChannelSocket,
  });
}
