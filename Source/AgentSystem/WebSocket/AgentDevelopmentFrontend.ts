import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

/** Vite owns this base in development; the authenticated application owns its public origin. */
export const AgentDevelopmentFrontendBase = "/development/";

export interface AgentDevelopmentFrontend {
  canHandle(pathname: string): boolean;
  handle(request: IncomingMessage, response: ServerResponse): Promise<void>;
  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void>;
  close(): void;
}
