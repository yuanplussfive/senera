import { readHostCapabilities, type SeneraSocketEvent, type SeneraSocketPort } from "@senera/resource-links";
import { AgentWebSocketCloseCodes } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketCloseContract";

/** The JSON transports share lifecycle semantics without replacing the global WebSocket. */
export interface ClientWebSocket {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export function createClientWebSocket(source: string | URL): ClientWebSocket {
  const url = new URL(source, window.location.href);
  if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password || url.hash)
    throw new TypeError("Invalid client WebSocket address.");
  const host = readHostCapabilities();
  return host?.connectSocket
    ? new HostedClientWebSocket(url.href, host.connectSocket.bind(host))
    : new WebSocket(url.href);
}

class HostedClientWebSocket implements ClientWebSocket {
  readyState: number = WebSocket.CONNECTING;
  onopen: ClientWebSocket["onopen"] = null;
  onmessage: ClientWebSocket["onmessage"] = null;
  onclose: ClientWebSocket["onclose"] = null;
  onerror: ClientWebSocket["onerror"] = null;
  private readonly port: SeneraSocketPort;

  constructor(url: string, connect: (url: string, receive: (event: SeneraSocketEvent) => void) => SeneraSocketPort) {
    this.port = connect(url, (event) => this.receive(event));
  }

  send(data: string): void {
    if (this.readyState !== WebSocket.OPEN) throw new DOMException("The connection is not open.", "InvalidStateError");
    void this.port.send(data).catch((error) => this.failed(error));
  }

  close(code = 1000, reason = ""): void {
    if (code !== 1000 && (code < 3000 || code > 4999))
      throw new DOMException("Invalid close code.", "InvalidAccessError");
    if (new TextEncoder().encode(reason).length > 123)
      throw new DOMException("Close reason is too long.", "SyntaxError");
    if (this.readyState >= WebSocket.CLOSING) return;
    this.readyState = WebSocket.CLOSING;
    void this.port.close(code, reason).catch((error) => this.failed(error));
  }

  private failed(error: unknown): void {
    if (this.readyState === WebSocket.CLOSED) return;
    try {
      this.receive({ type: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      void this.port.close(AgentWebSocketCloseCodes.HeartbeatTimeout, "host_transport_failed").catch(() => {});
      this.receive({ type: "close", code: 1006, reason: "host_transport_failed", wasClean: false });
    }
  }

  private receive(event: SeneraSocketEvent): void {
    if (this.readyState === WebSocket.CLOSED) return;
    switch (event.type) {
      case "open":
        if (this.readyState !== WebSocket.CONNECTING) return;
        this.readyState = WebSocket.OPEN;
        this.onopen?.(new Event("open"));
        break;
      case "message":
        if (this.readyState === WebSocket.OPEN) this.onmessage?.(new MessageEvent("message", { data: event.data }));
        break;
      case "error":
        this.onerror?.(new ErrorEvent("error", { message: event.message }));
        break;
      case "close":
        this.readyState = WebSocket.CLOSED;
        this.onclose?.(new CloseEvent("close", event));
        break;
    }
  }
}
