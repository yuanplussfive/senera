import type { ClientRequest } from "node:http";
import { Socket } from "node:net";
import { createProxyServer, proxyUpgrade } from "httpxy";
import {
  AgentDevelopmentFrontendBase,
  type AgentDevelopmentFrontend,
} from "../Source/AgentSystem/WebSocket/AgentDevelopmentFrontend.js";

/** Development resources and HMR share the authenticated host without exposing Vite to the LAN. */
export function createDevelopmentFrontendProxy(frontendUrl: string): AgentDevelopmentFrontend {
  const target = new URL(frontendUrl);
  const sockets = new Set<Socket>();
  const proxy = createProxyServer({ target: target.origin, changeOrigin: true, prependPath: false });
  const prepareRequest = (request: ClientRequest): void => {
    for (const header of ["cookie", "authorization", "x-senera-csrf"]) request.removeHeader(header);
    request.setHeader("Origin", target.origin);
  };
  proxy.on("proxyReq", prepareRequest);
  const track = (socket: Socket): void => {
    if (socket.destroyed) return;
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  };
  return {
    canHandle: (pathname) => pathname.startsWith(AgentDevelopmentFrontendBase),
    handle: (request, response) => proxy.web(request, response),
    upgrade: async (request, socket, head) => {
      if (!(socket instanceof Socket)) throw new Error("Development HMR requires a network socket.");
      track(socket);
      // Complete the upgrade at the handshake, not when the HMR tunnel eventually closes.
      // Authentication has already succeeded; host credentials must not reach Vite.
      request.headers = { ...request.headers, origin: target.origin };
      for (const header of ["cookie", "authorization", "x-senera-csrf"]) delete request.headers[header];
      track(
        await proxyUpgrade(target.origin, request, socket, head, {
          changeOrigin: true,
          xfwd: false,
          prependPath: false,
        }),
      );
    },
    close: () => {
      for (const socket of sockets) socket.destroy();
      sockets.clear();
      proxy.close();
    },
  };
}
