import type { ServerResponse } from "node:http";
import path from "node:path";
import ParcelWatcher from "@parcel/watcher";
import { relativePathWithin } from "../Core/AgentPath.js";
import { listAgentWorkspaceNonContentRoots } from "../Core/AgentWorkspaceLayout.js";

/** A serialized native watcher lease, shared by visible file panels. */
export class AgentWorkspaceFileChanges {
  private readonly clients = new Set<ServerResponse>();
  private subscription?: Awaited<ReturnType<typeof ParcelWatcher.subscribe>>;
  private transition: Promise<void> = Promise.resolve();
  private heartbeat?: NodeJS.Timeout;
  private revision = 0;
  private stopped = false;
  constructor(
    private readonly root: string,
    private readonly onChange: (paths: readonly string[]) => void,
  ) {}
  private serialize(operation: () => Promise<void>): Promise<void> {
    const result = this.transition.then(operation);
    this.transition = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  async subscribe(response: ServerResponse): Promise<void> {
    if (this.stopped) throw new Error("Workspace file watcher has stopped.");
    this.clients.add(response);
    response.once("close", () => {
      this.clients.delete(response);
      if (!this.clients.size)
        void this.close(false).catch((error: unknown) => response.destroy(error instanceof Error ? error : undefined));
    });
    try {
      await this.serialize(async () => {
        if (this.stopped || response.destroyed) return;
        if (!this.subscription) {
          this.onChange(["."]);
          this.subscription = await ParcelWatcher.subscribe(
            this.root,
            (error, events) => {
              if (error) {
                for (const client of this.clients) client.destroy(error);
                return;
              }
              const paths = events
                .map((event) => relativePathWithin(this.root, event.path))
                .filter((value): value is string => value !== undefined)
                .map((value) => value.split(path.sep).join("/"));
              if (!paths.length) return;
              this.onChange(paths);
              this.write(`data: ${JSON.stringify({ revision: ++this.revision, paths: [...new Set(paths)] })}\n\n`);
            },
            { ignore: [...listAgentWorkspaceNonContentRoots(this.root)] },
          );
          this.heartbeat = setInterval(() => this.write(": keepalive\n\n"), 30_000);
          this.heartbeat.unref();
        }
      });
      if (response.destroyed || this.stopped) return;
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      response.write(`data: ${JSON.stringify({ revision: this.revision, paths: ["."] })}\n\n`);
    } catch (error) {
      this.clients.delete(response);
      throw error;
    }
  }
  private write(frame: string): void {
    for (const client of this.clients) {
      if (client.headersSent && !client.destroyed && !client.write(frame))
        client.destroy(new Error("File change stream is not being consumed."));
    }
  }
  close(force = true): Promise<void> {
    if (force) this.stopped = true;
    return this.serialize(async () => {
      if (!force && this.clients.size) return;
      const subscription = this.subscription;
      this.subscription = undefined;
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = undefined;
      for (const client of this.clients) client.end();
      this.clients.clear();
      await subscription?.unsubscribe();
    });
  }
}
