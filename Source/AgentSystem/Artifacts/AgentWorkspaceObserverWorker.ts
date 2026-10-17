import process from "node:process";
import { createOpaqueId } from "../Core/AgentIds.js";
import { isAgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import { AgentWorkspaceChangeObserver, type AgentWorkspaceObservationLease } from "./AgentWorkspaceChangeObserver.js";
import type {
  AgentWorkspaceObserverWorkerRequest,
  AgentWorkspaceObserverWorkerResponsePayload,
} from "./AgentWorkspaceObserverWorkerProtocol.js";
import { AgentWorkspaceObserverWorkerProtocolVersion } from "./AgentWorkspaceObserverWorkerProtocol.js";
import type { ResolvedAgentArtifactsConfig } from "../Types/AgentConfigTypes.js";

let observer: AgentWorkspaceChangeObserver | undefined;
let currentConfig: ResolvedAgentArtifactsConfig | undefined;
const leases = new Map<string, AgentWorkspaceObservationLease>();
const leaseResourceIds = new Map<string, string>();
const activeCompletionRequests = new Set<Promise<void>>();
let dispatchQueue: Promise<void> = Promise.resolve();

process.on("message", (value: unknown) => {
  let request: AgentWorkspaceObserverWorkerRequest;
  try {
    request = readWorkerRequest(value);
  } catch (error) {
    sendFailure(undefined, error);
    return;
  }

  // A completed tool call may wait for sibling calls in the same batch before
  // resolving its response. Dispatch these join points concurrently so the
  // sibling completion messages can reach the observer and release the batch.
  if (request.type === "complete_call") {
    const operation = dispatchWorkerRequest(request).catch((error: unknown) => sendFailure(request.requestId, error));
    activeCompletionRequests.add(operation);
    void operation.then(
      () => activeCompletionRequests.delete(operation),
      () => activeCompletionRequests.delete(operation),
    );
    return;
  }

  dispatchQueue = dispatchQueue.then(async () => {
    try {
      if (request.type === "close") await Promise.all([...activeCompletionRequests]);
      await dispatchWorkerRequest(request);
    } catch (error) {
      sendFailure(request.requestId, error);
    }
  });
});

if (typeof process.send === "function") {
  sendResponse({ type: "ready" });
} else {
  process.exitCode = 1;
}

async function dispatchWorkerRequest(request: AgentWorkspaceObserverWorkerRequest): Promise<void> {
  switch (request.type) {
    case "initialize":
      await initializeObserver(request.workspaceRoot, request.config, request.runtimeStateRoot);
      sendResponse({ type: "ok", requestId: request.requestId });
      return;
    case "begin_batch":
      currentConfig = request.config;
      await currentObserver().beginBatch(request.batchId, request.callIds);
      sendResponse({ type: "ok", requestId: request.requestId });
      return;
    case "complete_call":
      currentConfig = request.config;
      sendResponse({
        type: "capture",
        requestId: request.requestId,
        capture: await currentObserver().completeCall(request.batchId, request.callId, request.exactPaths),
      });
      return;
    case "skip_call":
      currentObserver().skipCall(request.batchId, request.callId);
      return;
    case "cancel_call":
      currentObserver().cancelCall(request.batchId, request.callId);
      return;
    case "cancel_pending_batches":
      currentObserver().cancelPendingBatches();
      return;
    case "open_resource_lease": {
      currentConfig = request.config;
      const lease = await currentObserver().openResourceLease();
      if (!lease) throw new Error("Workspace observer did not return a resource lease.");
      const leaseId = createOpaqueId("workspace-observer-lease");
      leases.set(leaseId, lease);
      sendResponse({ type: "resource_lease", requestId: request.requestId, leaseId });
      return;
    }
    case "bind_resource_lease":
      leases.get(request.leaseId)?.bind(request.resourceId);
      if (leases.has(request.leaseId)) leaseResourceIds.set(request.leaseId, request.resourceId);
      return;
    case "complete_lease": {
      currentConfig = request.config;
      const lease = leases.get(request.leaseId);
      const capture = lease ? await lease.complete() : undefined;
      leases.delete(request.leaseId);
      leaseResourceIds.delete(request.leaseId);
      sendResponse({ type: "capture", requestId: request.requestId, capture });
      return;
    }
    case "complete_resource_lease":
      currentConfig = request.config;
      sendResponse({
        type: "capture",
        requestId: request.requestId,
        capture: await currentObserver().completeResourceLease(request.resourceId),
      });
      for (const [leaseId, resourceId] of leaseResourceIds) {
        if (resourceId === request.resourceId) {
          leases.delete(leaseId);
          leaseResourceIds.delete(leaseId);
        }
      }
      return;
    case "has_resource_lease":
      sendResponse({
        type: "resource_lease_state",
        requestId: request.requestId,
        active: currentObserver().hasResourceLease(request.resourceId),
      });
      return;
    case "cancel_lease": {
      const lease = leases.get(request.leaseId);
      lease?.cancel();
      leases.delete(request.leaseId);
      leaseResourceIds.delete(request.leaseId);
      return;
    }
    case "close":
      await currentObserver().close();
      sendResponse({ type: "ok", requestId: request.requestId });
      setImmediate(() => {
        process.disconnect?.();
        process.exit(0);
      });
      return;
  }
}

async function initializeObserver(
  workspaceRoot: string,
  config: ResolvedAgentArtifactsConfig,
  runtimeStateRoot?: string,
): Promise<void> {
  if (observer) throw new Error("Workspace observer worker was initialized more than once.");
  currentConfig = config;
  observer = new AgentWorkspaceChangeObserver({
    workspaceRoot,
    runtimeStateRoot,
    config: () => currentConfig ?? config,
    logger: createWorkerLogger(),
  });
}

function currentObserver(): AgentWorkspaceChangeObserver {
  if (!observer) throw new Error("Workspace observer worker has not been initialized.");
  return observer;
}

function createWorkerLogger(): AgentLogger {
  return {
    warn(message: string, details: Record<string, unknown> = {}): void {
      sendResponse({ type: "log", level: "warn", message, details });
    },
  } as unknown as AgentLogger;
}

function readWorkerRequest(value: unknown): AgentWorkspaceObserverWorkerRequest {
  if (!isAgentUnknownRecord(value)) throw new Error("Workspace observer worker received a non-object request.");
  if (value.protocolVersion !== AgentWorkspaceObserverWorkerProtocolVersion) {
    throw new Error("Workspace observer worker protocol version is unsupported.");
  }
  if (typeof value.type !== "string") throw new Error("Workspace observer worker request type is missing.");
  return value as unknown as AgentWorkspaceObserverWorkerRequest;
}

function sendResponse(response: AgentWorkspaceObserverWorkerResponsePayload & { readonly requestId?: string }): void {
  if (typeof process.send !== "function" || !process.connected) return;
  process.send({ ...response, protocolVersion: AgentWorkspaceObserverWorkerProtocolVersion });
}

function sendFailure(requestId: string | undefined, error: unknown): void {
  const failure = error instanceof Error ? error : new Error(String(error));
  sendResponse({
    type: "failure",
    ...(requestId ? { requestId } : {}),
    error: {
      name: failure.name,
      message: failure.message,
      ...(failure.stack ? { stack: failure.stack } : {}),
    },
  });
}
