import { sha256HexOfCanonicalJson } from "../Core/AgentHash.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";
import { awaitWithAbortSignal, throwAbortReason } from "../Core/AgentCancellation.js";
import {
  AgentMcpTaskDetachedError,
  AgentMcpToolClient,
  type AgentMcpToolCallOptions,
  type AgentMcpToolClientOptions,
  openAgentMcpToolClient,
} from "./AgentMcpToolClient.js";

type PooledClientOptions = Omit<AgentMcpToolClientOptions, "signal">;
type OpenClient = (options: AgentMcpToolClientOptions) => Promise<AgentMcpToolClient>;

export interface AgentMcpToolClientPoolPolicy {
  /** Idle time before a pooled connection is eligible for eviction. Zero disables eviction. */
  readonly idleTtlMs: number;
  /** How often the pool checks idle entries. Ignored when idleTtlMs is zero. */
  readonly sweepIntervalMs: number;
}

export type AgentMcpToolClientPoolPolicyProvider = AgentMcpToolClientPoolPolicy | (() => AgentMcpToolClientPoolPolicy);

export interface AgentMcpToolClientPoolOptions {
  readonly policy?: AgentMcpToolClientPoolPolicyProvider;
  readonly clock?: () => number;
  readonly onCloseError?: (error: unknown, options: PooledClientOptions) => void;
}

type ClientPoolEntryState = "opening" | "ready" | "retiring" | "closed";

interface AgentMcpToolClientPoolEntry {
  readonly key: string;
  readonly options: PooledClientOptions;
  readonly controller: AbortController;
  readonly opening: Promise<AgentMcpToolClient>;
  readonly idleResolvers: Array<() => void>;
  leases: number;
  lastUsedAt: number;
  state: ClientPoolEntryState;
  client?: AgentMcpToolClient;
  closing?: Promise<void>;
}

const MaxStaleClientReplacements = 1;
const NoIdleEvictionPolicy: AgentMcpToolClientPoolPolicy = {
  idleTtlMs: 0,
  sweepIntervalMs: 1,
};
const ConnectionDependencyIds = new WeakMap<object, number>();
let nextConnectionDependencyId = 1;

export class AgentMcpToolClientUnavailableError extends AgentBaseError {
  constructor(
    readonly serverId: string,
    readonly replacements: number,
  ) {
    super(`MCP server ${serverId} closed during connection acquisition after ${replacements} replacement attempt(s).`);
  }
}

/**
 * Owns pooled MCP connections. A lease protects every active operation, while
 * an idle sweep reclaims completed connections without losing the tool
 * catalog held by the caller. A later call opens the same endpoint again.
 */
export class AgentMcpToolClientPool {
  private readonly entries = new Map<string, AgentMcpToolClientPoolEntry>();
  private readonly retiring = new Set<AgentMcpToolClientPoolEntry>();
  private readonly openClient: OpenClient;
  private readonly policy: AgentMcpToolClientPoolPolicyProvider;
  private readonly clock: () => number;
  private readonly onCloseError?: AgentMcpToolClientPoolOptions["onCloseError"];
  private sweepTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private closePromise: Promise<void> | undefined;

  constructor(openClient?: OpenClient, options?: AgentMcpToolClientPoolOptions);
  constructor(options?: AgentMcpToolClientPoolOptions);
  constructor(
    openClientOrOptions: OpenClient | AgentMcpToolClientPoolOptions = openAgentMcpToolClient,
    options: AgentMcpToolClientPoolOptions = {},
  ) {
    if (typeof openClientOrOptions === "function") {
      this.openClient = openClientOrOptions;
      this.policy = options.policy ?? NoIdleEvictionPolicy;
      this.clock = options.clock ?? Date.now;
      this.onCloseError = options.onCloseError;
      return;
    }
    this.openClient = openAgentMcpToolClient;
    this.policy = openClientOrOptions.policy ?? NoIdleEvictionPolicy;
    this.clock = openClientOrOptions.clock ?? Date.now;
    this.onCloseError = openClientOrOptions.onCloseError;
  }

  async withClient<TValue>(
    options: AgentMcpToolClientOptions,
    operation: (client: AgentMcpToolClient) => Promise<TValue>,
  ): Promise<TValue> {
    const { signal, ...connectionOptions } = options;
    for (let replacements = 0; ; replacements += 1) {
      throwAbortReason(signal);
      const entry = this.acquire(connectionOptions);
      this.retain(entry);
      try {
        const client = await awaitWithAbortSignal(entry.opening, signal);
        if (client.closed) {
          this.retire(entry);
          if (replacements >= MaxStaleClientReplacements) {
            throw new AgentMcpToolClientUnavailableError(options.server.id, replacements);
          }
          continue;
        }

        try {
          return await operation(client);
        } catch (error) {
          if (client.closed) this.retire(entry);
          throw error;
        }
      } finally {
        this.release(entry);
      }
    }
  }

  async withRecoverableTask<TValue>(
    options: PooledClientOptions,
    operation: (client: AgentMcpToolClient) => Promise<TValue>,
    taskOptions: AgentMcpToolCallOptions,
    onDetached?: (error: AgentMcpTaskDetachedError) => void,
  ): Promise<TValue> {
    try {
      return await this.withClient({ ...options, signal: taskOptions.signal }, operation);
    } catch (error) {
      if (!(error instanceof AgentMcpTaskDetachedError)) throw error;
      onDetached?.(error);
      return this.withClient(
        { ...options, signal: taskOptions.signal },
        (client) => client.reattachTask(error.taskId, taskOptions) as Promise<TValue>,
      );
    }
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    const closing = this.closeClients().finally(() => {
      if (this.closePromise === closing) this.closePromise = undefined;
    });
    this.closePromise = closing;
    return closing;
  }

  private async closeClients(): Promise<void> {
    this.closed = true;
    this.clearSweepTimer();
    const entries = new Set([...this.entries.values(), ...this.retiring]);
    for (const entry of entries) this.retire(entry);
    const results = await Promise.allSettled([...entries].map((entry) => this.closeWhenIdle(entry)));
    const failures = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "MCP client pool cleanup failed.");
  }

  private acquire(options: PooledClientOptions): AgentMcpToolClientPoolEntry {
    if (this.closed) throw new Error("MCP tool client pool is closed.");
    const key = createAgentMcpToolClientPoolKey(options);
    const current = this.entries.get(key);
    if (current && current.state !== "retiring" && current.state !== "closed") return current;

    const controller = new AbortController();
    const entry: AgentMcpToolClientPoolEntry = {
      key,
      options,
      controller,
      opening: this.openClient({ ...options, signal: controller.signal }),
      idleResolvers: [],
      leases: 0,
      lastUsedAt: this.clock(),
      state: "opening",
    };
    this.entries.set(key, entry);
    void entry.opening
      .then((client) => {
        entry.client = client;
        if (entry.state === "opening") entry.state = "ready";
        this.scheduleSweep();
      })
      .catch(() => {
        entry.state = "closed";
        if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
        this.retiring.delete(entry);
        this.resolveIdleWaiters(entry);
      });
    this.scheduleSweep();
    return entry;
  }

  private retain(entry: AgentMcpToolClientPoolEntry): void {
    entry.leases += 1;
    entry.lastUsedAt = this.clock();
  }

  private release(entry: AgentMcpToolClientPoolEntry): void {
    entry.leases = Math.max(0, entry.leases - 1);
    entry.lastUsedAt = this.clock();
    if (entry.leases === 0) {
      this.resolveIdleWaiters(entry);
      if (entry.state === "retiring" && !entry.closing) {
        void this.closeWhenIdle(entry).catch((error) => this.reportCloseError(error, entry));
      }
    }
    this.scheduleSweep();
  }

  private retire(entry: AgentMcpToolClientPoolEntry): void {
    if (entry.state === "retiring" || entry.state === "closed") return;
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
    entry.state = "retiring";
    this.retiring.add(entry);
    entry.controller.abort();
    if (entry.leases === 0) {
      void this.closeWhenIdle(entry).catch((error) => this.reportCloseError(error, entry));
    }
  }

  private closeWhenIdle(entry: AgentMcpToolClientPoolEntry): Promise<void> {
    if (entry.closing) return entry.closing;
    const closing = (async () => {
      if (entry.leases > 0) {
        await new Promise<void>((resolve) => entry.idleResolvers.push(resolve));
      }
      await this.closeEntry(entry);
    })();
    const settled = closing.then(
      () => undefined,
      (error) => {
        throw error;
      },
    );
    const tracked = settled.finally(() => {
      if (entry.closing === tracked) entry.closing = undefined;
    });
    entry.closing = tracked;
    return tracked;
  }

  private async closeEntry(entry: AgentMcpToolClientPoolEntry): Promise<void> {
    const client = entry.client ?? (await this.openingClient(entry));
    if (client) await client.close();
    entry.state = "closed";
    this.retiring.delete(entry);
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
    this.resolveIdleWaiters(entry);
  }

  private async openingClient(entry: AgentMcpToolClientPoolEntry): Promise<AgentMcpToolClient | undefined> {
    try {
      const client = await entry.opening;
      entry.client = client;
      return client;
    } catch {
      entry.state = "closed";
      this.retiring.delete(entry);
      if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key);
      this.resolveIdleWaiters(entry);
      return undefined;
    }
  }

  private resolveIdleWaiters(entry: AgentMcpToolClientPoolEntry): void {
    if (entry.leases !== 0) return;
    const waiters = entry.idleResolvers.splice(0);
    for (const resolve of waiters) resolve();
  }

  private scheduleSweep(): void {
    if (this.closed || this.sweepTimer || this.entries.size === 0) return;
    const policy = this.resolvePolicy();
    if (policy.idleTtlMs <= 0) return;
    this.sweepTimer = setTimeout(() => {
      this.sweepTimer = undefined;
      this.sweepIdleEntries();
    }, policy.sweepIntervalMs);
    const timer = this.sweepTimer as unknown as { unref?: () => void };
    timer.unref?.();
  }

  private sweepIdleEntries(): void {
    if (this.closed) return;
    const { idleTtlMs } = this.resolvePolicy();
    const now = this.clock();
    if (idleTtlMs > 0) {
      for (const entry of this.entries.values()) {
        if (entry.leases === 0 && entry.state === "ready" && now - entry.lastUsedAt >= idleTtlMs) {
          this.retire(entry);
        }
      }
    }
    this.scheduleSweep();
  }

  private clearSweepTimer(): void {
    if (!this.sweepTimer) return;
    clearTimeout(this.sweepTimer);
    this.sweepTimer = undefined;
  }

  private resolvePolicy(): AgentMcpToolClientPoolPolicy {
    const policy = typeof this.policy === "function" ? this.policy() : this.policy;
    if (!Number.isFinite(policy.idleTtlMs) || policy.idleTtlMs < 0) {
      throw new RangeError("MCP client idle TTL must be a finite non-negative number.");
    }
    if (!Number.isFinite(policy.sweepIntervalMs) || policy.sweepIntervalMs <= 0) {
      throw new RangeError("MCP client sweep interval must be a finite positive number.");
    }
    return policy;
  }

  private reportCloseError(error: unknown, entry: AgentMcpToolClientPoolEntry): void {
    this.onCloseError?.(error, entry.options);
  }
}

export function createAgentMcpToolClientPoolKey(options: PooledClientOptions): string {
  return sha256HexOfCanonicalJson({
    server: options.server,
    executionProfile: options.executionProfile,
    requestTimeoutMs: options.requestTimeoutMs,
    terminationGraceMs: options.terminationGraceMs,
    maxFrameBytes: options.maxFrameBytes ?? null,
    maxStderrBytes: options.maxStderrBytes ?? null,
    spawnPersistentProcess: connectionDependencyIdentity(options.spawnPersistentProcess),
    interactionInput: connectionDependencyIdentity(options.interactionInput),
    sampling: connectionDependencyIdentity(options.sampling),
    onToolsChanged: connectionDependencyIdentity(options.onToolsChanged),
  });
}

function connectionDependencyIdentity(value: object | undefined): number | null {
  if (!value) return null;
  const current = ConnectionDependencyIds.get(value);
  if (current) return current;
  const identity = nextConnectionDependencyId;
  nextConnectionDependencyId += 1;
  ConnectionDependencyIds.set(value, identity);
  return identity;
}
