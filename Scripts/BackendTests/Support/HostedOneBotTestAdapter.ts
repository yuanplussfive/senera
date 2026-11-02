import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { WebSocketServer } from "ws";
import {
  AgentOneBot11ChannelAdapter,
  type AgentOneBot11ChannelAdapterOptions,
} from "../../../Source/AgentSystem/Channels/Adapters/AgentOneBot11ChannelAdapter.js";

/** Test listener around the real embedded protocol; identities seed existing workspace state. */
export class HostedOneBotTestAdapter extends AgentOneBot11ChannelAdapter {
  private readonly server = createServer((request, response) => {
    const name = path.basename(new URL(request.url!, "http://test.local").pathname);
    void readFile(path.join(this.input.runtimeDirectory, "media", name)).then(
      (data) => response.end(data),
      () => {
        response.writeHead(404);
        response.end();
      },
    );
  });
  private readonly sockets = new WebSocketServer({ noServer: true });

  constructor(
    private readonly input: Omit<AgentOneBot11ChannelAdapterOptions, "mediaBasePath"> & {
      port: number;
      selfId?: number;
      operatorId?: number;
    },
  ) {
    super({ ...input, mediaBasePath: `http://127.0.0.1:${input.port}/media` });
    this.server.on("upgrade", (request, socket, head) => {
      this.sockets.handleUpgrade(request, socket, head, (client) => this.connectClient(client, request));
    });
  }

  override async connect(signal: AbortSignal): Promise<void> {
    if (this.input.selfId !== undefined && this.input.operatorId !== undefined) {
      await mkdir(this.input.runtimeDirectory, { recursive: true });
      try {
        await writeFile(
          path.join(this.input.runtimeDirectory, "identity.json"),
          JSON.stringify({
            selfId: this.input.selfId,
            operatorId: this.input.operatorId,
          }),
          { flag: "wx" },
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    await super.connect(signal);
    if (signal.aborted || this.getConnectionState() !== "connected" || this.server.listening) return;
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.input.port, "127.0.0.1", () => {
        this.server.off("error", reject);
        resolve();
      });
    });
  }

  override getConnectionInfo() {
    const info = super.getConnectionInfo();
    return info ? { ...info, endpoint: `ws://127.0.0.1:${this.input.port}/socket` } : undefined;
  }

  override async disconnect(): Promise<void> {
    await super.disconnect();
    for (const socket of this.sockets.clients) socket.terminate();
    if (this.server.listening) await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}
