import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { utilityProcess, type UtilityProcess } from "electron";
import {
  DesktopServerParentMessageKinds,
  DesktopServerProcessMessageKinds,
  type DesktopServerBootstrap,
  type DesktopServerParentMessage,
  type DesktopServerProcessMessage,
  type DesktopServerSnapshot,
} from "./DesktopServerProcessProtocol.js";

export interface DesktopServerHostOptions {
  readonly bootstrap: DesktopServerBootstrap;
  readonly onWorkspaceOpened: (workspaceRoot: string, workspaceId: string) => void;
}

export interface DesktopServerHandle extends DesktopServerSnapshot {
  stop(): Promise<void>;
}

/**
 * Owns the desktop server's utility process. The Electron main process remains dedicated to native
 * windows and IPC, while synchronous database startup and workspace initialization run elsewhere.
 */
export class DesktopServerHost {
  private readonly output = new ProcessOutputTail();
  private readonly pending = new Map<string, { resolve(): void; reject(error: Error): void }>();
  private snapshot: DesktopServerSnapshot | undefined;
  private startup?: { resolve(host: DesktopServerHost): void; reject(error: Error): void };
  private exited = false;

  private constructor(
    private readonly process: UtilityProcess,
    private readonly onWorkspaceOpened: DesktopServerHostOptions["onWorkspaceOpened"],
  ) {
    captureProcessOutput(process.stdout, this.output);
    captureProcessOutput(process.stderr, this.output);
    process.on("message", (message: unknown) => this.receiveMessage(message));
    process.on("exit", (code) => this.finish(this.exitedError(`Desktop server process exited with code ${code}.`)));
    process.on("error", (_type, location, report) => {
      this.finish(this.exitedError(`Desktop server process terminated at ${location}: ${report}`));
    });
  }

  static start(options: DesktopServerHostOptions): Promise<DesktopServerHost> {
    // Built by `Build/BundleDesktopServer.ts`: loading the unbundled graph costs
    // seconds of module resolution before the window can show anything.
    const modulePath = fileURLToPath(new URL("./DesktopServerProcess.bundle.mjs", import.meta.url));
    const process = utilityProcess.fork(modulePath, [], {
      cwd: options.bootstrap.resourcesRoot,
      env: processEnvironment(),
      // Keep the server isolated from the Electron main process while retaining
      // bounded diagnostics when its module graph cannot start.
      stdio: ["ignore", "pipe", "pipe"],
      serviceName: "Senera Server",
    });
    const host = new DesktopServerHost(process, options.onWorkspaceOpened);
    return host.begin(options.bootstrap);
  }

  currentHandle(): DesktopServerHandle {
    const snapshot = this.requireSnapshot();
    return {
      ...snapshot,
      stop: () => this.stop(),
    };
  }

  private begin(bootstrap: DesktopServerBootstrap): Promise<DesktopServerHost> {
    return new Promise<DesktopServerHost>((resolve, reject) => {
      this.startup = { resolve, reject };
      this.send({ kind: DesktopServerParentMessageKinds.Start, bootstrap });
    });
  }

  private async stop(): Promise<void> {
    if (this.exited) return;
    const requestId = randomUUID();
    await this.request({ kind: DesktopServerParentMessageKinds.Stop, requestId });
    this.process.kill();
  }

  private request(
    message: Extract<DesktopServerParentMessage, { kind: typeof DesktopServerParentMessageKinds.Stop }>,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.pending.set(message.requestId, { resolve, reject });
      this.send(message);
    });
  }

  private send(message: DesktopServerParentMessage): void {
    if (this.exited) throw new Error("Desktop server process is unavailable.");
    this.process.postMessage(message);
  }

  private receiveMessage(message: unknown): void {
    if (!isDesktopServerProcessMessage(message)) return;
    switch (message.kind) {
      case DesktopServerProcessMessageKinds.Ready:
        this.snapshot = message.snapshot;
        this.startup?.resolve(this);
        this.startup = undefined;
        return;
      case DesktopServerProcessMessageKinds.WorkspaceOpened:
        this.updateWorkspace(message.workspaceRoot, message.workspaceId);
        return;
      case DesktopServerProcessMessageKinds.Stopped:
        this.resolveRequest(message.requestId);
        return;
      case DesktopServerProcessMessageKinds.Failed:
        this.rejectRequest(message.requestId, new Error(message.message));
        return;
    }
  }

  private updateWorkspace(workspaceRoot: string, workspaceId: string): void {
    if (this.snapshot) {
      const websocketUrl = new URL(this.snapshot.websocketUrl);
      websocketUrl.searchParams.set("workspaceId", workspaceId);
      this.snapshot = { ...this.snapshot, workspaceRoot, websocketUrl: websocketUrl.toString() };
    }
    this.onWorkspaceOpened(workspaceRoot, workspaceId);
  }

  private resolveRequest(requestId: string): void {
    const request = this.pending.get(requestId);
    if (!request) return;
    this.pending.delete(requestId);
    request.resolve();
  }

  private rejectRequest(requestId: string | undefined, error: Error): void {
    if (requestId) {
      const request = this.pending.get(requestId);
      if (request) {
        this.pending.delete(requestId);
        request.reject(error);
        return;
      }
      return;
    }
    this.startup?.reject(error);
    this.startup = undefined;
  }

  private finish(error: Error): void {
    if (this.exited) return;
    this.exited = true;
    this.rejectRequest(undefined, error);
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  private exitedError(message: string): Error {
    const diagnostic = this.output.text();
    return new Error(diagnostic ? `${message}\n\nDesktop server diagnostics:\n${diagnostic}` : message);
  }

  private requireSnapshot(): DesktopServerSnapshot {
    if (!this.snapshot) throw new Error("Desktop server process has not reported readiness.");
    return this.snapshot;
  }
}

const DesktopServerDiagnosticLimit = 32 * 1024;

/** Retains the end of a child stream without allowing failure diagnostics to grow unbounded. */
class ProcessOutputTail {
  private value = "";

  append(chunk: Buffer | string): void {
    this.value += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (this.value.length > DesktopServerDiagnosticLimit) {
      this.value = this.value.slice(-DesktopServerDiagnosticLimit);
    }
  }

  text(): string | undefined {
    const output = this.value.trim();
    return output || undefined;
  }
}

function captureProcessOutput(stream: NodeJS.ReadableStream | null, output: ProcessOutputTail): void {
  stream?.on("data", (chunk: Buffer | string) => output.append(chunk));
}

function processEnvironment(): NodeJS.ProcessEnv {
  return { ...process.env };
}

function isDesktopServerProcessMessage(value: unknown): value is DesktopServerProcessMessage {
  if (!value || typeof value !== "object" || !("kind" in value)) return false;
  const message = value as {
    kind?: unknown;
    requestId?: unknown;
    snapshot?: unknown;
    workspaceRoot?: unknown;
    workspaceId?: unknown;
    message?: unknown;
  };
  if (message.kind === DesktopServerProcessMessageKinds.Ready) return isDesktopServerSnapshot(message.snapshot);
  if (message.kind === DesktopServerProcessMessageKinds.WorkspaceOpened) {
    return isNonEmptyString(message.workspaceRoot) && isNonEmptyString(message.workspaceId);
  }
  if (message.kind === DesktopServerProcessMessageKinds.Stopped) return isNonEmptyString(message.requestId);
  return message.kind === DesktopServerProcessMessageKinds.Failed && isNonEmptyString(message.message);
}

function isDesktopServerSnapshot(value: unknown): value is DesktopServerSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<DesktopServerSnapshot>;
  return [snapshot.workspaceRoot, snapshot.configPath, snapshot.websocketUrl, snapshot.healthUrl].every(
    isNonEmptyString,
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
