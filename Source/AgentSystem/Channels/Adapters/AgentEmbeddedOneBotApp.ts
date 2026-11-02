import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import { BaseApp, Router, type Account, type WsServer } from "onebots";

/** OneBots owns the protocol handlers; the Senera listener supplies accepted sockets. */
class EmbeddedOneBotRouter extends Router {
  private readonly protocolSockets = new Map<string, WsServer>();

  override ws(...args: Parameters<Router["ws"]>): WsServer {
    const server = super.ws(...args);
    this.protocolSockets.set(server.path, server);
    return server;
  }

  connect(path: string, socket: WebSocket, request: IncomingMessage): void {
    const server = this.protocolSockets.get(path);
    if (!server || !this.getWsPaths().includes(path)) throw new Error("OneBot protocol is unavailable.");
    // These sockets were upgraded by the host. Include them in the protocol's
    // ownership so stopping a workspace also closes its clients.
    server.clients.add(socket);
    socket.once("close", () => server.clients.delete(socket));
    server.emit("connection", socket, request);
  }

  override async cleanupAsync(): Promise<void> {
    try {
      await super.cleanupAsync();
    } finally {
      this.protocolSockets.clear();
    }
  }
}

/** An embedded OneBots runtime with no TCP listener of its own. */
export class AgentEmbeddedOneBotApp extends BaseApp {
  private protocolRouter?: EmbeddedOneBotRouter;

  async initializeAccount(config: Account.Config): Promise<void> {
    // Construct without accounts, then install the host socket adapter before
    // the library constructs protocols and captures their router.
    await this.router.cleanupAsync();
    const router = new EmbeddedOneBotRouter(this.httpServer);
    this.router = router;
    this.protocolRouter = router;
    const adapter = this.findOrCreateAdapter(config.platform);
    const scope = router.createRegistrationScope({ platform: config.platform, account_id: config.account_id });
    try {
      const account = scope.run(() => adapter.createAccount(config));
      account.attachRouteScope(scope);
      adapter.accounts.set(config.account_id, account);
    } catch (error) {
      scope.close();
      throw error;
    }
  }

  connectClient(socket: WebSocket, request: IncomingMessage): void {
    if (!this.isStarted) throw new Error("OneBot channel is not connected.");
    const protocol = this.accounts.flatMap((account) => account.protocols).find((entry) => entry.name === "onebot");
    if (!protocol || !this.protocolRouter) throw new Error("OneBot protocol is unavailable.");
    this.protocolRouter.connect(protocol.path, socket, request);
  }

  override async start(): Promise<void> {
    this.assertCanStart();
    try {
      await this.lifecycle.start();
      for (const adapter of this.adapters.values()) await adapter.start();
      this.isStarted = true;
    } catch (error) {
      await this.rollbackFailedStart(error);
    }
  }
}
