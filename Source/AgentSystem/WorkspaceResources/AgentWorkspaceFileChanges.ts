import type { ServerResponse } from "node:http";
import path from "node:path";
import ParcelWatcher from "@parcel/watcher";
import { relativePathWithin } from "../Core/AgentPath.js";
import { AgentWorkspaceFileDiscovery } from "./AgentWorkspaceFileDiscovery.js";

export type AgentWorkspaceFileChange =
  | { readonly type: "create" | "update" | "delete"; readonly path: string }
  | { readonly type: "watch-error"; readonly error: Error };

/** A serialized native watcher lease, shared by visible file panels. */
export class AgentWorkspaceFileChanges {
  private readonly clients = new Map<string, Set<ServerResponse>>();
  private readonly discovery: AgentWorkspaceFileDiscovery;
  private transition: Promise<void> = Promise.resolve();
  private heartbeat?: NodeJS.Timeout;
  private revision = 0;
  private stopped = false;
  private subscription?: Awaited<ReturnType<typeof ParcelWatcher.subscribe>>;
  constructor(
    private readonly root: string,
    private readonly onChange: (changes: readonly AgentWorkspaceFileChange[]) => Promise<void>,
  ) {
    this.discovery = new AgentWorkspaceFileDiscovery(root);
  }
  private serialize(operation: () => Promise<void>): Promise<void> {
    const result = this.transition.then(operation);
    this.transition = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  async start(): Promise<void> {
    await this.serialize(async () => this.ensureSubscription());
  }
  async publish(changes: readonly AgentWorkspaceFileChange[]): Promise<void> {
    if (this.stopped || !changes.length) return;
    await this.serialize(async () => this.applyChanges(changes));
  }
  async subscribe(response: ServerResponse, scope = "."): Promise<void> {
    if (this.stopped) throw new Error("Workspace file watcher has stopped.");
    let registeredScope: string | undefined;
    response.once("close", () => {
      if (!registeredScope) return;
      void this.unsubscribe(registeredScope, response).catch((error: unknown) =>
        response.destroy(error instanceof Error ? error : undefined),
      );
    });
    try {
      await this.serialize(async () => {
        if (this.stopped || response.destroyed) return;
        await this.ensureSubscription();
        registeredScope = scope;
        const clients = this.clients.get(scope) ?? new Set<ServerResponse>();
        clients.add(response);
        this.clients.set(scope, clients);
      });
      if (response.destroyed || this.stopped) return;
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      response.write(`data: ${JSON.stringify({ revision: this.revision, paths: [scope] })}\n\n`);
    } catch (error) {
      if (registeredScope) this.clients.get(registeredScope)?.delete(response);
      throw error;
    }
  }
  private async ensureSubscription(): Promise<void> {
    if (this.subscription || this.stopped) return;
    this.subscription = await ParcelWatcher.subscribe(
      this.root,
      (error, events) => {
        const changes: readonly AgentWorkspaceFileChange[] = error
          ? [{ type: "watch-error", error }]
          : events.flatMap((event) => {
              const relative = relativePathWithin(this.root, event.path);
              const workspacePath = relative === undefined ? undefined : normalizeWorkspacePath(relative);
              return !workspacePath || !this.discovery.isObservablePath(workspacePath)
                ? []
                : [{ type: event.type, path: workspacePath }];
            });
        if (!changes.length) return;
        void this.serialize(async () => this.applyChanges(changes)).catch((failure: unknown) => {
          this.destroyClients(failure instanceof Error ? failure : new Error(String(failure)));
        });
      },
      { ignore: [...this.discovery.watchIgnoredRoots()] },
    );
    if (!this.heartbeat) {
      this.heartbeat = setInterval(() => {
        for (const clients of this.clients.values()) this.write(clients, ": keepalive\n\n");
      }, 30_000);
      this.heartbeat.unref();
    }
  }
  private async applyChanges(changes: readonly AgentWorkspaceFileChange[]): Promise<void> {
    await this.onChange(changes);
    const failure = changes.find((change) => change.type === "watch-error");
    if (failure?.type === "watch-error") {
      this.destroyClients(failure.error);
      await this.subscription?.unsubscribe();
      this.subscription = undefined;
      return;
    }
    const paths = [...new Set(changes.flatMap((change) => (change.type === "watch-error" ? [] : [change.path])))];
    if (!paths.length) return;
    for (const [scope, clients] of this.clients) {
      const scopedPaths = paths.filter((candidate) => isWorkspacePathWithinScope(scope, candidate));
      if (scopedPaths.length)
        this.write(clients, `data: ${JSON.stringify({ revision: ++this.revision, paths: scopedPaths })}\n\n`);
    }
  }
  private async unsubscribe(scope: string, response: ServerResponse): Promise<void> {
    await this.serialize(async () => {
      const clients = this.clients.get(scope);
      if (!clients) return;
      clients.delete(response);
      if (!clients.size) this.clients.delete(scope);
    });
  }
  private write(clients: Iterable<ServerResponse>, frame: string): void {
    for (const client of clients) {
      if (client.headersSent && !client.destroyed && !client.write(frame))
        client.destroy(new Error("File change stream is not being consumed."));
    }
  }
  private destroyClients(error: Error): void {
    for (const clients of this.clients.values()) {
      for (const client of clients) client.destroy(error);
    }
    this.clients.clear();
  }
  close(force = true): Promise<void> {
    if (force) this.stopped = true;
    return this.serialize(async () => {
      if (!force && [...this.clients.values()].some((clients) => clients.size)) return;
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = undefined;
      for (const clients of this.clients.values()) for (const client of clients) client.end();
      this.clients.clear();
      await this.subscription?.unsubscribe();
      this.subscription = undefined;
    });
  }
}

function normalizeWorkspacePath(value: string): string {
  return value.split(path.sep).join("/") || ".";
}

function isWorkspacePathWithinScope(scope: string, candidate: string): boolean {
  if (scope === ".") return true;
  return candidate === scope || candidate.startsWith(`${scope}/`);
}
