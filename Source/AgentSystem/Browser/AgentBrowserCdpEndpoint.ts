import WebSocket from "ws";

const CdpProbeTimeoutMs = 1_000;

interface CdpProbeResponse {
  readonly id?: number;
  readonly result?: unknown;
}

/**
 * A leased CDP endpoint outlives the browser when the user closes the managed
 * window or the browser crashes. Probing before every reuse lets the profile
 * coordinator relaunch instead of sending commands to a closed port.
 */
export async function probeAgentBrowserCdpEndpoint(cdpUrl: string, timeoutMs = CdpProbeTimeoutMs): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new WebSocket(cdpUrl, { handshakeTimeout: timeoutMs });
    let settled = false;
    const finish = (alive: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.terminate();
      resolve(alive);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);

    socket.once("open", () => {
      try {
        socket.send(JSON.stringify({ id: 1, method: "Browser.getVersion" }));
      } catch {
        finish(false);
      }
    });
    socket.once("message", (raw) => {
      try {
        const response = JSON.parse(raw.toString()) as CdpProbeResponse;
        finish(response.id === 1 && Boolean(response.result));
      } catch {
        finish(false);
      }
    });
    socket.once("error", () => finish(false));
    socket.once("close", () => finish(false));
  });
}
