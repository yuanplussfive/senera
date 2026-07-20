import path from "node:path";
import { createOpaqueId } from "../Core/AgentIds.js";
import { AgentEventKinds, type AgentEventSink } from "../Events/AgentEvent.js";
import type { SeneraExecutionEnv } from "../Execution/SeneraExecutionTypes.js";
import type { SeneraProcessExecutionProfile } from "../Execution/SeneraExecutionProfile.js";
import { normalizeSeneraTerminalDimensions, type SeneraTerminalDimensions } from "../Execution/SeneraTerminalTypes.js";
import type { SeneraShellCommandSpec } from "../Execution/SeneraShellCommand.js";
import { AgentExecutionResourceError, AgentExecutionResourceErrorCodes } from "./AgentExecutionResourceError.js";
import type { AgentExecutionResourceDomainEvent } from "./AgentExecutionResourceEventTypes.js";
import { AgentProcessExecutionResource } from "./AgentProcessExecutionResource.js";
import {
  AgentPipeProcessTransport,
  AgentPtyTerminalTransport,
  type AgentExecutionResourceTransport,
} from "./AgentExecutionResourceTransport.js";
import {
  type AgentExecutionResourceCorrelation,
  type AgentExecutionResourceHandle,
  type AgentExecutionResourceLimits,
  type AgentExecutionResourceOwner,
  type AgentExecutionResourceSignal,
  type AgentExecutionResourceSnapshot,
} from "./AgentExecutionResourceTypes.js";

export interface AgentExecutionResourceBrokerOptions {
  workspaceRoot: string;
  limits: AgentExecutionResourceLimits | (() => AgentExecutionResourceLimits);
  executionEnv?: SeneraExecutionEnv;
  eventSink?: AgentEventSink;
  onCleanupFailure?: (failure: AgentExecutionResourceCleanupFailure) => void;
  now?: () => number;
}

export interface AgentExecutionResourceCleanupFailure {
  readonly resourceId: string;
  readonly reason: Extract<AgentExecutionResourceDomainEvent, { kind: "execution.resource.removed" }>['data']['reason'];
  readonly error: unknown;
}

export interface AgentExecutionProcessStartRequest {
  command: string;
  args: readonly string[];
  displayCommand?: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  profile?: SeneraProcessExecutionProfile;
  executionEnv?: SeneraExecutionEnv;
  owner: AgentExecutionResourceOwner;
  correlation: AgentExecutionResourceCorrelation;
  signal?: AbortSignal;
}

export interface AgentExecutionTerminalStartRequest extends AgentExecutionProcessStartRequest {
  dimensions?: Partial<SeneraTerminalDimensions>;
  terminalName?: string;
  shellCommand?: SeneraShellCommandSpec;
}

export class AgentExecutionResourceBroker {
  private readonly workspaceRoot: string;
  private readonly resources = new Map<string, AgentExecutionResourceHandle>();
  private readonly cleanupInFlight = new Map<string, Promise<void>>();
  private readonly pendingStarts = new Set<Promise<void>>();
  private timer?: ReturnType<typeof setTimeout>;
  private readonly now: () => number;
  private closed = false;
  private closeInFlight: Promise<void> | undefined;
  private eventSink: AgentEventSink | undefined;
  private readonly cleanupFailures = new Map<string, AgentExecutionResourceCleanupFailure>();

  constructor(private readonly options: AgentExecutionResourceBrokerOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.now = options.now ?? Date.now;
    this.eventSink = options.eventSink;
    this.scheduleSweep();
  }

  setEventSink(eventSink: AgentEventSink | undefined): void {
    this.eventSink = eventSink;
  }

  async startProcess(request: AgentExecutionProcessStartRequest): Promise<AgentExecutionResourceSnapshot> {
    const executionEnv = this.requireExecutionEnv(request.executionEnv);
    return this.startResource(request, async () => {
      const child = await executionEnv.spawnPersistentProcess(request.command, request.args, {
        cwd: request.cwd,
        env: request.env,
        windowsHide: true,
        signal: request.signal,
        profile: request.profile,
      });
      return new AgentPipeProcessTransport(child);
    });
  }

  async startTerminal(request: AgentExecutionTerminalStartRequest): Promise<AgentExecutionResourceSnapshot> {
    const executionEnv = this.requireExecutionEnv(request.executionEnv);
    const dimensions = normalizeSeneraTerminalDimensions(request.dimensions);
    return this.startResource(request, async () => {
      const child = await executionEnv.spawnTerminal(request.command, request.args, {
        cwd: request.cwd,
        env: request.env,
        columns: dimensions.columns,
        rows: dimensions.rows,
        name: request.terminalName,
        signal: request.signal,
        profile: request.profile,
        maxDurationMs: this.limits.terminalTtlMs,
        shellCommand: request.shellCommand,
      });
      return new AgentPtyTerminalTransport(child, dimensions);
    });
  }

  list(owner: AgentExecutionResourceOwner): AgentExecutionResourceSnapshot[] {
    this.assertOpen();
    this.assertOwner(owner);
    return [...this.resources.values()]
      .filter((resource) => sameOwner(resource.owner, owner))
      .map((resource) => this.inspectWithCleanupStatus(resource, Number.MAX_SAFE_INTEGER))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  inspect(resourceId: string, owner: AgentExecutionResourceOwner, cursor = 0): AgentExecutionResourceSnapshot {
    return this.inspectWithCleanupStatus(this.authorize(resourceId, owner), cursor);
  }

  async wait(
    resourceId: string,
    owner: AgentExecutionResourceOwner,
    cursor: number,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<AgentExecutionResourceSnapshot> {
    const boundedTimeout = Math.min(Math.max(0, timeoutMs), this.limits.maxWaitMs);
    const resource = this.authorize(resourceId, owner);
    return this.decorateSnapshot(resource, await resource.wait(cursor, boundedTimeout, signal));
  }

  async write(
    resourceId: string,
    owner: AgentExecutionResourceOwner,
    input: Uint8Array,
  ): Promise<AgentExecutionResourceSnapshot> {
    const maxInputBytes = this.limits.maxInputBytes;
    if (input.byteLength > maxInputBytes) {
      throw new AgentExecutionResourceError(
        AgentExecutionResourceErrorCodes.InputTooLarge,
        `Execution resource input exceeds ${maxInputBytes} bytes.`,
        { resourceId, byteLength: input.byteLength, maxInputBytes },
      );
    }
    const resource = this.authorize(resourceId, owner);
    return this.decorateSnapshot(resource, await resource.write(input));
  }

  async resize(
    resourceId: string,
    owner: AgentExecutionResourceOwner,
    dimensions: SeneraTerminalDimensions,
  ): Promise<AgentExecutionResourceSnapshot> {
    const normalized = normalizeSeneraTerminalDimensions(dimensions);
    const resource = this.authorize(resourceId, owner);
    const snapshot = await resource.resize(normalized.columns, normalized.rows);
    this.project({
      kind: AgentEventKinds.ExecutionResourceResized,
      context: { sessionId: owner.sessionId, requestId: owner.requestId },
      data: { resourceId, ...normalized },
    });
    return this.decorateSnapshot(resource, snapshot);
  }

  async signal(
    resourceId: string,
    owner: AgentExecutionResourceOwner,
    signal: AgentExecutionResourceSignal,
  ): Promise<AgentExecutionResourceSnapshot> {
    const resource = this.authorize(resourceId, owner);
    return this.decorateSnapshot(resource, await resource.signal(signal));
  }

  async stopAll(owner: AgentExecutionResourceOwner): Promise<AgentExecutionResourceSnapshot[]> {
    this.assertOpen();
    this.assertOwner(owner);
    const resources = [...this.resources.values()].filter(
      (resource) => sameOwner(resource.owner, owner) && !resource.closed,
    );
    const settlements = await Promise.allSettled(
      resources.map((resource) => this.cleanupResource(resource, "stop_all")),
    );
    throwCleanupFailures(settlements, "Execution resource stop_all failed.");
    return resources
      .filter((resource) => this.resources.get(resource.id) === resource)
      .map((resource) => this.inspectWithCleanupStatus(resource, Number.MAX_SAFE_INTEGER));
  }

  async releaseAll(owner: AgentExecutionResourceOwner): Promise<void> {
    this.assertOpen();
    this.assertOwner(owner);
    const resources = [...this.resources.values()].filter((resource) => sameOwner(resource.owner, owner));
    const settlements = await Promise.allSettled(
      resources.map((resource) => this.cleanupResource(resource, "released")),
    );
    throwCleanupFailures(settlements, "Execution resource release failed.");
  }

  close(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      if (this.timer) clearTimeout(this.timer);
    }
    if (this.closeInFlight) return this.closeInFlight;

    const closing = this.closeResources().finally(() => {
      if (this.closeInFlight === closing) this.closeInFlight = undefined;
    });
    this.closeInFlight = closing;
    return closing;
  }

  private async closeResources(): Promise<void> {
    const startSettlements = await Promise.allSettled([...this.pendingStarts]);
    const resources = [...this.resources.values()];
    const resourceSettlements = await Promise.allSettled(
      resources.map((resource) => this.cleanupResource(resource, "broker_closed")),
    );
    throwCleanupFailures([...startSettlements, ...resourceSettlements], "Execution resource broker shutdown failed.");
  }

  private authorize(resourceId: string, owner: AgentExecutionResourceOwner): AgentExecutionResourceHandle {
    this.assertOpen();
    this.assertOwner(owner);
    const resource = this.resources.get(resourceId);
    if (!resource) {
      throw new AgentExecutionResourceError(
        AgentExecutionResourceErrorCodes.NotFound,
        `Execution resource ${resourceId} was not found.`,
        { resourceId },
      );
    }
    if (!sameOwner(resource.owner, owner)) {
      throw new AgentExecutionResourceError(
        AgentExecutionResourceErrorCodes.AccessDenied,
        `Execution resource ${resourceId} belongs to another session or request.`,
        { resourceId },
      );
    }
    return resource;
  }

  private async startResource(
    request: AgentExecutionProcessStartRequest,
    createTransport: () => Promise<AgentExecutionResourceTransport>,
  ): Promise<AgentExecutionResourceSnapshot> {
    this.assertOpen();
    this.assertOwner(request.owner);
    const limits = this.limits;
    if (this.activeCount() + this.pendingStarts.size >= limits.maxActive) {
      throw new AgentExecutionResourceError(
        AgentExecutionResourceErrorCodes.CapacityExceeded,
        `Execution resource capacity ${limits.maxActive} has been reached.`,
        { maxActive: limits.maxActive },
      );
    }

    const pending = createPendingStartSettlement();
    this.pendingStarts.add(pending.promise);
    try {
      const transport = await createTransport();
      if (this.closed) {
        try {
          await transport.close(limits.terminationGraceMs);
          pending.resolve();
        } catch (error) {
          pending.reject(error);
          throw error;
        }
        throw new AgentExecutionResourceError(
          AgentExecutionResourceErrorCodes.Closed,
          "Execution resource broker closed while the resource was starting.",
        );
      }
      const resource = new AgentProcessExecutionResource({
        id: createOpaqueId("res"),
        owner: request.owner,
        correlation: {
          ...request.correlation,
          onEvent: (event) => (this.eventSink ?? request.correlation.onEvent)?.(event),
        },
        transport,
        command: request.displayCommand ?? [request.command, ...request.args].join(" "),
        cwd: request.cwd,
        limits,
        now: this.now,
      });
      this.resources.set(resource.id, resource);
      const snapshot = resource.inspect();
      this.project(
        {
          kind: AgentEventKinds.ExecutionResourceCreated,
          context: {
            sessionId: request.correlation.sessionId ?? request.owner.sessionId,
            requestId: request.correlation.requestId ?? request.owner.requestId,
            step: request.correlation.step,
          },
          data: { resource: snapshot },
        },
        request.correlation.onEvent,
      );
      pending.resolve();
      return snapshot;
    } catch (error) {
      pending.resolve();
      throw error;
    } finally {
      this.pendingStarts.delete(pending.promise);
    }
  }

  private requireExecutionEnv(override?: SeneraExecutionEnv): SeneraExecutionEnv {
    const executionEnv = override ?? this.options.executionEnv;
    if (executionEnv) return executionEnv;
    throw new AgentExecutionResourceError(
      AgentExecutionResourceErrorCodes.InvalidOwner,
      "Starting an execution resource requires an execution environment.",
    );
  }

  private assertOwner(owner: AgentExecutionResourceOwner): void {
    const ownerWorkspace = path.resolve(owner.workspaceRoot);
    if (ownerWorkspace !== this.workspaceRoot || (!owner.sessionId && !owner.requestId)) {
      throw new AgentExecutionResourceError(
        AgentExecutionResourceErrorCodes.InvalidOwner,
        "Execution resources require the current workspace and a session or request identity.",
        { workspaceRoot: ownerWorkspace },
      );
    }
  }

  private activeCount(): number {
    return [...this.resources.values()].filter((resource) => !resource.closed).length;
  }

  private async sweep(): Promise<void> {
    try {
      const now = this.now();
      const limits = this.limits;
      const expired = [...this.resources.values()].filter((resource) => {
        const ttl = resource.closed ? limits.terminalTtlMs : limits.idleTtlMs;
        return now - resource.lastAccessedAt >= ttl;
      });
      await Promise.allSettled(expired.map((resource) => this.cleanupResource(resource, "expired")));
    } finally {
      this.scheduleSweep();
    }
  }

  private scheduleSweep(): void {
    if (this.closed) return;
    this.timer = setTimeout(() => void this.sweep(), this.limits.sweepIntervalMs);
    this.timer.unref();
  }

  private get limits(): AgentExecutionResourceLimits {
    return typeof this.options.limits === "function" ? this.options.limits() : this.options.limits;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new AgentExecutionResourceError(
        AgentExecutionResourceErrorCodes.Closed,
        "Execution resource broker is closed.",
      );
    }
  }

  private cleanupResource(
    resource: AgentExecutionResourceHandle,
    reason: Extract<AgentExecutionResourceDomainEvent, { kind: "execution.resource.removed" }>["data"]["reason"],
  ): Promise<void> {
    const current = this.cleanupInFlight.get(resource.id);
    if (current) return current;

    const observed = this.performResourceCleanup(resource, reason)
      .catch((error) => {
        this.recordCleanupFailure(resource, reason, error);
        throw error;
      })
      .finally(() => {
        if (this.cleanupInFlight.get(resource.id) === observed) {
          this.cleanupInFlight.delete(resource.id);
        }
      });
    this.cleanupInFlight.set(resource.id, observed);
    return observed;
  }

  private async performResourceCleanup(
    resource: AgentExecutionResourceHandle,
    reason: Extract<AgentExecutionResourceDomainEvent, { kind: "execution.resource.removed" }>["data"]["reason"],
  ): Promise<void> {
    await resource.close();
    if (!resource.closed) {
      throw new AgentExecutionResourceError(
        AgentExecutionResourceErrorCodes.CleanupFailed,
        `Execution resource ${resource.id} did not confirm process termination.`,
        { resourceId: resource.id, state: resource.state },
      );
    }
    if (this.resources.get(resource.id) !== resource) return;
    this.resources.delete(resource.id);
    this.cleanupFailures.delete(resource.id);
    this.projectResourceRemoved(resource, reason);
  }

  private inspectWithCleanupStatus(
    resource: AgentExecutionResourceHandle,
    cursor: number,
  ): AgentExecutionResourceSnapshot {
    return this.decorateSnapshot(resource, resource.inspect(cursor));
  }

  private decorateSnapshot(
    resource: AgentExecutionResourceHandle,
    snapshot: AgentExecutionResourceSnapshot,
  ): AgentExecutionResourceSnapshot {
    const failure = this.cleanupFailures.get(resource.id);
    if (!failure) return snapshot;
    return {
      ...snapshot,
      error: `资源清理失败（${failure.reason}）：${formatCleanupFailure(failure.error)}`,
    };
  }

  private recordCleanupFailure(
    resource: AgentExecutionResourceHandle,
    reason: AgentExecutionResourceCleanupFailure['reason'],
    error: unknown,
  ): void {
    const failure = { resourceId: resource.id, reason, error } satisfies AgentExecutionResourceCleanupFailure;
    this.cleanupFailures.set(resource.id, failure);
    this.options.onCleanupFailure?.(failure);
  }

  private projectResourceRemoved(
    resource: AgentExecutionResourceHandle,
    reason: Extract<AgentExecutionResourceDomainEvent, { kind: "execution.resource.removed" }>["data"]["reason"],
  ): void {
    this.project({
      kind: AgentEventKinds.ExecutionResourceRemoved,
      context: { sessionId: resource.owner.sessionId, requestId: resource.owner.requestId },
      data: { resourceId: resource.id, reason },
    });
  }

  private project(event: AgentExecutionResourceDomainEvent, fallback?: AgentEventSink): void {
    const sink = this.eventSink ?? fallback;
    if (!sink) return;
    void Promise.resolve(sink(event)).catch(() => undefined);
  }
}

function sameOwner(actual: AgentExecutionResourceOwner, candidate: AgentExecutionResourceOwner): boolean {
  if (path.resolve(actual.workspaceRoot) !== path.resolve(candidate.workspaceRoot)) return false;
  return actual.sessionId ? actual.sessionId === candidate.sessionId : actual.requestId === candidate.requestId;
}

function throwCleanupFailures(settlements: readonly PromiseSettledResult<void>[], message: string): void {
  const failures = settlements.flatMap((outcome) => (outcome.status === "rejected" ? [outcome.reason] : []));
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, message);
}

function formatCleanupFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createPendingStartSettlement(): {
  promise: Promise<void>;
  resolve(): void;
  reject(error: unknown): void;
} {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}
