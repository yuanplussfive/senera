import type { ChildProcess } from "node:child_process";
import { isAgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { ResolvedAgentArtifactsConfig } from "../Types/AgentConfigTypes.js";
import type { ToolWorkspaceCaptureResult } from "../Types/ToolRuntimeTypes.js";
import type {
  AgentWorkspaceChangeObserverPort,
  AgentWorkspaceObservationLease,
} from "./AgentWorkspaceChangeObserver.js";
import { launchAgentWorkspaceObserverWorker } from "./AgentWorkspaceObserverWorkerLauncher.js";
import {
  AgentWorkspaceObserverWorkerProtocolVersion,
  type AgentWorkspaceObserverWorkerRequest,
  type AgentWorkspaceObserverWorkerRequestPayload,
  type AgentWorkspaceObserverWorkerResponse,
} from "./AgentWorkspaceObserverWorkerProtocol.js";

export interface AgentWorkspaceChangeObserverProcessOptions {
  readonly workspaceRoot: string;
  readonly runtimeStateRoot?: string;
  readonly config: () => ResolvedAgentArtifactsConfig;
  readonly logger?: AgentLogger;
}

interface PendingRequest {
  readonly resolve: (response: AgentWorkspaceObserverWorkerResponse) => void;
  readonly reject: (error: Error) => void;
}

interface WorkerLeaseState {
  resourceId?: string;
}

export class AgentWorkspaceChangeObserverProcess implements AgentWorkspaceChangeObserverPort {
  private child?: ChildProcess;
  private readyPromise?: Promise<void>;
  private closePromise?: Promise<void>;
  private idleTimer?: NodeJS.Timeout;
  private workerError?: Error;
  private sequence = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly batches = new Map<string, Set<string>>();
  private readonly leases = new Map<string, WorkerLeaseState>();
  private notificationQueue: Promise<void> = Promise.resolve();
  private pendingNotifications = 0;
  private workerStopping = false;
  private workerStopPromise?: Promise<void>;
  private closed = false;

  constructor(private readonly options: AgentWorkspaceChangeObserverProcessOptions) {}

  async beginBatch(batchId: string, callIds: readonly string[]): Promise<void> {
    if (this.closed || callIds.length === 0 || this.batches.has(batchId)) return;
    this.cancelIdleShutdown();
    await this.request({
      type: "begin_batch",
      batchId,
      callIds: [...callIds],
      config: this.options.config(),
    });
    this.batches.set(batchId, new Set(callIds));
  }

  async completeCall(
    batchId: string,
    callId: string,
    exactPaths: readonly string[] = [],
  ): Promise<ToolWorkspaceCaptureResult | undefined> {
    if (!this.batches.get(batchId)?.has(callId)) return undefined;
    const response = await this.request({
      type: "complete_call",
      batchId,
      callId,
      exactPaths: [...exactPaths],
      config: this.options.config(),
    });
    this.completeBatchCall(batchId, callId);
    return response.type === "capture" ? response.capture : undefined;
  }

  skipCall(batchId: string, callId: string): void {
    if (!this.batches.get(batchId)?.has(callId)) return;
    this.completeBatchCall(batchId, callId);
    void this.notify({ type: "skip_call", batchId, callId });
  }

  cancelCall(batchId: string, callId: string): void {
    if (!this.batches.get(batchId)?.has(callId)) return;
    this.completeBatchCall(batchId, callId);
    void this.notify({ type: "cancel_call", batchId, callId });
  }

  cancelPendingBatches(): void {
    if (this.closed) return;
    this.batches.clear();
    void this.notify({ type: "cancel_pending_batches" });
  }

  async openResourceLease(): Promise<AgentWorkspaceObservationLease> {
    this.cancelIdleShutdown();
    const response = await this.request({
      type: "open_resource_lease",
      config: this.options.config(),
    });
    if (response.type !== "resource_lease") throw unexpectedResponse("resource_lease", response);
    this.leases.set(response.leaseId, {});
    return {
      bind: (resourceId) => this.bindLease(response.leaseId, resourceId),
      complete: () => this.completeLease(response.leaseId),
      cancel: () => this.cancelLease(response.leaseId),
    };
  }

  async completeResourceLease(resourceId: string): Promise<ToolWorkspaceCaptureResult | undefined> {
    const response = await this.request({
      type: "complete_resource_lease",
      resourceId,
      config: this.options.config(),
    });
    for (const [leaseId, lease] of this.leases) {
      if (lease.resourceId === resourceId) this.leases.delete(leaseId);
    }
    this.scheduleIdleShutdown();
    return response.type === "capture" ? response.capture : undefined;
  }

  hasResourceLease(resourceId: string): boolean {
    return [...this.leases.values()].some((lease) => lease.resourceId === resourceId);
  }

  close(): Promise<void> {
    return (this.closePromise ??= this.closeOwnedResources());
  }

  private async completeLease(leaseId: string): Promise<ToolWorkspaceCaptureResult | undefined> {
    if (!this.leases.has(leaseId)) return undefined;
    const response = await this.request({
      type: "complete_lease",
      leaseId,
      config: this.options.config(),
    });
    this.leases.delete(leaseId);
    this.scheduleIdleShutdown();
    return response.type === "capture" ? response.capture : undefined;
  }

  private bindLease(leaseId: string, resourceId: string): void {
    const lease = this.leases.get(leaseId);
    if (!lease || !resourceId.trim()) return;
    lease.resourceId = resourceId;
    void this.notify({ type: "bind_resource_lease", leaseId, resourceId });
  }

  private cancelLease(leaseId: string): void {
    if (!this.leases.delete(leaseId)) return;
    void this.notify({ type: "cancel_lease", leaseId });
    this.scheduleIdleShutdown();
  }

  private completeBatchCall(batchId: string, callId: string): void {
    const calls = this.batches.get(batchId);
    if (!calls) return;
    calls.delete(callId);
    if (calls.size === 0) this.batches.delete(batchId);
    this.scheduleIdleShutdown();
  }

  private async request(
    request: AgentWorkspaceObserverWorkerRequestPayload,
  ): Promise<AgentWorkspaceObserverWorkerResponse> {
    if (this.closed) throw new Error("Workspace observer process is closed.");
    const child = await this.ensureWorker();
    const requestId = `workspace-observer-request-${++this.sequence}`;
    const message = {
      ...request,
      requestId,
      protocolVersion: AgentWorkspaceObserverWorkerProtocolVersion,
    } as AgentWorkspaceObserverWorkerRequest;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      try {
        child.send(message, (error) => {
          if (!error) return;
          this.pending.delete(requestId);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      } catch (error) {
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private async notify(request: AgentWorkspaceObserverWorkerRequestPayload): Promise<void> {
    this.pendingNotifications += 1;
    const operation = this.notificationQueue
      .then(async () => {
        if (this.closed) return;
        const child = await this.ensureWorker();
        const message = {
          ...request,
          protocolVersion: AgentWorkspaceObserverWorkerProtocolVersion,
        } as AgentWorkspaceObserverWorkerRequest;
        await new Promise<void>((resolve, reject) => {
          child.send(message, (error) => (error ? reject(error) : resolve()));
        });
      })
      .catch((error: unknown) => {
        this.failWorker(error);
      })
      .finally(() => {
        this.pendingNotifications -= 1;
        this.scheduleIdleShutdown();
      });
    this.notificationQueue = operation;
    return operation;
  }

  private ensureWorker(): Promise<ChildProcess> {
    if (this.workerStopping) {
      return (this.workerStopPromise ?? Promise.resolve()).then(() => this.ensureWorker());
    }
    if (this.child && this.readyPromise) return this.readyPromise.then(() => this.child as ChildProcess);
    if (this.closed) return Promise.reject(new Error("Workspace observer process is closed."));

    this.workerError = undefined;
    const child = launchAgentWorkspaceObserverWorker({
      parentModuleUrl: import.meta.url,
      cwd: this.options.workspaceRoot,
    });
    this.child = child;
    let resolveReady!: () => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    this.readyPromise = ready;
    child.stderr?.on("data", (chunk: Buffer | string) => {
      const message = String(chunk).trim();
      if (message) this.options.logger?.warn("workspace.observer.worker_stderr", { message });
    });
    child.on("message", (value: unknown) => this.receiveWorkerMessage(value, resolveReady, rejectReady));
    child.once("error", (error) => this.failWorker(error));
    child.once("exit", (code, signal) => {
      const failure =
        this.workerError ?? new Error(`Workspace observer worker exited (${code ?? "?"}/${signal ?? "?"}).`);
      if (this.child === child) {
        this.child = undefined;
        this.readyPromise = undefined;
        this.batches.clear();
        this.leases.clear();
      }
      rejectReady(failure);
      this.rejectPending(failure);
    });
    const initialized = ready.then(async () => {
      const response = await this.sendRequestToChild(child, {
        type: "initialize",
        workspaceRoot: this.options.workspaceRoot,
        runtimeStateRoot: this.options.runtimeStateRoot,
        config: this.options.config(),
      });
      if (response.type !== "ok") throw unexpectedResponse("ok", response);
    });
    this.readyPromise = initialized;
    void initialized.catch((error: unknown) => {
      this.failWorker(error);
      rejectReady(error instanceof Error ? error : new Error(String(error)));
    });
    return initialized.then(() => child);
  }

  private sendRequestToChild(
    child: ChildProcess,
    request: AgentWorkspaceObserverWorkerRequestPayload,
  ): Promise<AgentWorkspaceObserverWorkerResponse> {
    const requestId = `workspace-observer-request-${++this.sequence}`;
    const message = {
      ...request,
      requestId,
      protocolVersion: AgentWorkspaceObserverWorkerProtocolVersion,
    } as AgentWorkspaceObserverWorkerRequest;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      child.send(message, (error) => {
        if (!error) return;
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  private receiveWorkerMessage(value: unknown, resolveReady: () => void, rejectReady: (error: Error) => void): void {
    if (!isAgentUnknownRecord(value) || value.protocolVersion !== AgentWorkspaceObserverWorkerProtocolVersion) {
      const error = new Error("Workspace observer worker returned an invalid protocol message.");
      this.failWorker(error);
      rejectReady(error);
      return;
    }
    const response = value as unknown as AgentWorkspaceObserverWorkerResponse;
    if (response.type === "ready") {
      resolveReady();
      return;
    }
    if (response.type === "log") {
      this.options.logger?.warn(response.message, response.details);
      return;
    }
    if (response.type === "failure") {
      const error = new Error(response.error.message);
      error.name = response.error.name;
      if (response.error.stack) error.stack = response.error.stack;
      if (response.requestId) this.pending.get(response.requestId)?.reject(error);
      else this.failWorker(error);
      if (response.requestId) this.pending.delete(response.requestId);
      return;
    }
    if (!response.requestId) return;
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    this.pending.delete(response.requestId);
    pending.resolve(response);
  }

  private failWorker(error: unknown): void {
    const failure = error instanceof Error ? error : new Error(String(error));
    this.workerError = failure;
    this.rejectPending(failure);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private scheduleIdleShutdown(): void {
    if (
      !this.child ||
      this.batches.size > 0 ||
      this.leases.size > 0 ||
      this.pendingNotifications > 0 ||
      this.workerStopping ||
      this.closed
    )
      return;
    this.cancelIdleShutdown();
    const ttlMs = this.options.config().WorkspaceObserverIdleTtlMs;
    if (ttlMs <= 0) {
      setTimeout(() => {
        void this.stopWorker().catch((error: unknown) => this.failWorker(error));
      }, 0).unref();
      return;
    }
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      void this.stopWorker().catch((error: unknown) => this.failWorker(error));
    }, ttlMs);
    this.idleTimer.unref();
  }

  private cancelIdleShutdown(): void {
    if (!this.idleTimer) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private stopWorker(): Promise<void> {
    if (this.workerStopPromise) return this.workerStopPromise;
    const child = this.child;
    if (!child || this.batches.size > 0 || this.leases.size > 0 || this.pendingNotifications > 0 || this.workerStopping)
      return Promise.resolve();
    this.workerStopping = true;
    this.cancelIdleShutdown();
    const trackedPromise: Promise<void> = (async () => {
      try {
        await this.notificationQueue;
        const response = await this.sendRequestToChild(child, { type: "close" });
        if (response.type !== "ok") throw unexpectedResponse("ok", response);
      } finally {
        await terminateWorker(child);
        if (this.child === child) {
          this.child = undefined;
          this.readyPromise = undefined;
          this.workerError = undefined;
        }
        this.workerStopping = false;
        this.workerStopPromise = undefined;
      }
    })();
    this.workerStopPromise = trackedPromise;
    return trackedPromise;
  }

  private async closeOwnedResources(): Promise<void> {
    this.closed = true;
    this.cancelIdleShutdown();
    this.batches.clear();
    this.leases.clear();
    await this.notificationQueue;
    const stopping = this.workerStopPromise;
    if (stopping) {
      await stopping;
      return;
    }
    const child = this.child;
    if (!child) return;
    try {
      const response = await this.sendRequestToChild(child, { type: "close" });
      if (response.type !== "ok") throw unexpectedResponse("ok", response);
    } finally {
      await terminateWorker(child);
      this.child = undefined;
      this.readyPromise = undefined;
    }
  }
}

async function terminateWorker(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (child.connected) child.disconnect();
  child.kill("SIGTERM");
  await waitForWorkerExit(child, 1_000);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

function waitForWorkerExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    timeout.unref();
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function unexpectedResponse(expected: string, response: AgentWorkspaceObserverWorkerResponse): Error {
  return new Error(`Workspace observer worker expected ${expected}, received ${response.type}.`);
}
