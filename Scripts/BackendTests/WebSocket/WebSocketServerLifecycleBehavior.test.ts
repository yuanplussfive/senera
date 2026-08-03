import net from "node:net";
import { once } from "node:events";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentWebSocketServer } from "../../../Source/AgentSystem/WebSocket/AgentWebSocketServer.js";
import { AgentCallbackRunEventWriter } from "../../../Source/AgentSystem/WebSocket/AgentCallbackRunEventWriter.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";
import { createTemporaryDirectory, removeDirectory } from "../Support/AgentTestFixtures.js";
import { AgentPiTurnContextRegistry } from "../../../Source/AgentSystem/PiShared/AgentPiTurnContext.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) removeDirectory(directory);
});

describe("WebSocket server lifecycle", () => {
  test("waits for shutdown before resolving and releases the listening port", async () => {
    const port = await reserveTcpPort();
    const workspaceRoot = createTemporaryDirectory("senera-websocket-lifecycle");
    temporaryDirectories.push(workspaceRoot);
    const config: AgentSystemConfig = {
      Server: { Host: "127.0.0.1", Port: port },
      ModelProviders: [],
    };
    const server = new AgentWebSocketServer({
      config,
      workspaceRoot,
      sessionManager: {} as never,
      userProfileManager: {} as never,
      eventWriter: new AgentCallbackRunEventWriter(vi.fn()),
      piTurnContexts: new AgentPiTurnContextRegistry(),
    });

    await server.start();
    const stopping = server.stop();
    expect(server.stop()).toBe(stopping);
    await stopping;

    const rebound = net.createServer();
    try {
      rebound.listen(port, "127.0.0.1");
      await once(rebound, "listening");
      expect(rebound.listening).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => {
        rebound.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  test("returns a stable 500 response when the final HTTP router promise rejects", async () => {
    const port = await reserveTcpPort();
    const workspaceRoot = createTemporaryDirectory("senera-websocket-http-failure");
    temporaryDirectories.push(workspaceRoot);
    const config: AgentSystemConfig = {
      Server: { Host: "127.0.0.1", Port: port },
      ModelProviders: [],
    };
    const server = new AgentWebSocketServer({
      config,
      workspaceRoot,
      sessionManager: {} as never,
      userProfileManager: {} as never,
      eventWriter: new AgentCallbackRunEventWriter(vi.fn()),
      piTurnContexts: new AgentPiTurnContextRegistry(),
    });
    const mutableServer = server as unknown as {
      httpRouter: { handle(): Promise<void> };
    };
    mutableServer.httpRouter = {
      handle: async () => {
        throw new Error("router rejected");
      },
    };

    await server.start();
    try {
      const response = await fetch(`http://127.0.0.1:${port}/failing-route`);
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: { code: "internal_error" },
      });
    } finally {
      await server.stop();
    }
  });
});

async function reserveTcpPort(): Promise<number> {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to reserve a TCP port for the test.");
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}
