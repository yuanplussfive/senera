import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { describe, expect, test } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { probeAgentBrowserCdpEndpoint } from "../../../Source/AgentSystem/Browser/AgentBrowserCdpEndpoint.js";

interface ProbeServer {
  readonly url: string;
  close(): Promise<void>;
}

describe("probeAgentBrowserCdpEndpoint", () => {
  test("accepts an endpoint that answers Browser.getVersion", async () => {
    const server = await createProbeServer((socket, message) => {
      if (message.id !== undefined) socket.send(JSON.stringify({ id: message.id, result: { product: "Edge/142" } }));
    });
    try {
      await expect(probeAgentBrowserCdpEndpoint(server.url)).resolves.toBe(true);
    } finally {
      await server.close();
    }
  });

  test("rejects an endpoint whose browser has exited", async () => {
    const server = await createProbeServer(() => undefined);
    const url = server.url;
    await server.close();

    await expect(probeAgentBrowserCdpEndpoint(url)).resolves.toBe(false);
  });

  test("rejects an endpoint that does not answer in time", async () => {
    const server = await createProbeServer(() => undefined);
    try {
      await expect(probeAgentBrowserCdpEndpoint(server.url, 150)).resolves.toBe(false);
    } finally {
      await server.close();
    }
  });
});

async function createProbeServer(
  handle: (socket: WebSocket, message: { readonly id?: number }) => void,
): Promise<ProbeServer> {
  const sockets = new Set<WebSocket>();
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("message", (raw) => handle(socket, JSON.parse(raw.toString()) as { readonly id?: number }));
  });
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  return {
    url: `ws://127.0.0.1:${port}/devtools/browser/probe`,
    close: async () => {
      for (const socket of sockets) socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
