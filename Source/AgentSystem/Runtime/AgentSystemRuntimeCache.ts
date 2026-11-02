import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { AgentSystemRuntime, type AgentSystemRuntimeFromConfigOptions } from "./AgentSystemRuntime.js";
import { createAgentRuntimePreparationFingerprint } from "./AgentRuntimePreparationFingerprint.js";
import type { WorkspaceAgent } from "../Core/AgentDirectoryContract.js";

export interface AgentSystemRuntimeCacheSnapshot {
  version: number;
  revision?: number;
  sourceRevisions?: Readonly<Record<string, string | number>>;
  config: AgentSystemConfig;
}

export interface AgentSystemRuntimeCacheRuntime {
  initialize?(): void | Promise<void>;
  close(): void | Promise<void>;
}

export interface AgentSystemRuntimeCacheRuntimeFactoryInput extends Omit<
  AgentSystemRuntimeFromConfigOptions,
  "config" | "workspaceRoot" | "configPath"
> {
  workspaceRoot: string;
  configPath: string;
  snapshot: AgentSystemRuntimeCacheSnapshot;
}

export interface AgentSystemRuntimeLease<TRuntime extends AgentSystemRuntimeCacheRuntime> {
  readonly fingerprint: string;
  readonly preparationFingerprint: string;
  readonly runtime: TRuntime;
  release(): void;
}

export type AgentSystemRuntimeCacheOptions<TRuntime extends AgentSystemRuntimeCacheRuntime = AgentSystemRuntime> = Omit<
  AgentSystemRuntimeCacheRuntimeFactoryInput,
  "snapshot" | "modelProviderId"
> & {
  snapshot: () => AgentSystemRuntimeCacheSnapshot;
  maxIdleEntries?: number;
  runtimeFactory?: (input: AgentSystemRuntimeCacheRuntimeFactoryInput) => TRuntime;
  agentServices?: (
    agent?: WorkspaceAgent,
  ) => Pick<
    AgentSystemRuntimeCacheRuntimeFactoryInput,
    | "continuityMemory"
    | "continuityIdentity"
    | "continuityLifecycle"
    | "continuityRecall"
    | "continuityMemOS"
    | "executionLedger"
    | "todos"
    | "learningRequests"
  >;
};

type AgentSystemRuntimeCreationDependencies = Omit<
  AgentSystemRuntimeCacheRuntimeFactoryInput,
  "snapshot" | "modelProviderId"
>;

interface RuntimeCacheEntry<TRuntime extends AgentSystemRuntimeCacheRuntime> {
  readonly agentId?: string;
  readonly fingerprint: string;
  readonly preparationFingerprint: string;
  readonly runtime: TRuntime;
  state: "initializing" | "ready" | "failed";
  closing: boolean;
  closePromise?: Promise<void>;
  leases: number;
  lastAccess: number;
}

export class AgentSystemRuntimeCache<TRuntime extends AgentSystemRuntimeCacheRuntime = AgentSystemRuntime> {
  private readonly entries = new Map<string, RuntimeCacheEntry<TRuntime>>();
  private readonly pendingClosures = new Map<Promise<void>, string | undefined>();
  private readonly retiredAgentIds = new Set<string>();
  private readonly maxIdleEntries: number;
  private accessSequence = 0;
  private observed = true;

  constructor(private readonly options: AgentSystemRuntimeCacheOptions<TRuntime>) {
    this.maxIdleEntries = normalizeMaxIdleEntries(options.maxIdleEntries);
  }

  acquire(modelProviderId?: string, activeAgent?: WorkspaceAgent): AgentSystemRuntimeLease<TRuntime> {
    if (activeAgent && this.retiredAgentIds.has(activeAgent.id))
      throw new Error("This Agent runtime has been retired.");
    const snapshot = this.options.snapshot();
    const fingerprint = JSON.stringify([
      runtimeFingerprint(snapshot, modelProviderId, this.options.workspaceRoot, this.options.configPath),
      activeAgent,
    ]);
    let entry = this.entries.get(fingerprint);
    if (!entry) {
      entry = {
        agentId: activeAgent?.id,
        fingerprint,
        preparationFingerprint: createAgentRuntimePreparationFingerprint({
          config: snapshot.config,
          modelProviderId,
          sourceRevisions: {
            ...snapshot.sourceRevisions,
            ...(activeAgent ? { agent: JSON.stringify(activeAgent) } : {}),
          },
        }),
        runtime: this.createRuntime(snapshot, modelProviderId, activeAgent),
        state: "ready",
        closing: false,
        leases: 1,
        lastAccess: this.nextAccessSequence(),
      };
      this.entries.set(fingerprint, entry);
      this.initializeEntry(entry);
      return this.createLease(entry);
    }

    entry.leases += 1;
    entry.lastAccess = this.nextAccessSequence();
    return this.createLease(entry);
  }

  async clear(): Promise<void> {
    for (const entry of this.entries.values()) {
      this.closeEntry(entry);
    }
    this.entries.clear();
    const outcomes = await Promise.allSettled([...this.pendingClosures.keys()]);
    const failures = outcomes.flatMap((outcome) => (outcome.status === "rejected" ? [outcome.reason] : []));
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Runtime cache shutdown failed.");
  }

  async retireAgent(agentId: string): Promise<void> {
    const selected = [...this.entries.values()].filter((entry) => entry.agentId === agentId);
    if (selected.some((entry) => entry.leases > 0)) throw new Error("Agent executions have not finished stopping.");
    this.retiredAgentIds.add(agentId);
    for (const entry of selected) this.entries.delete(entry.fingerprint);
    for (const entry of selected) this.closeEntry(entry);
    // Include evicted runtimes that are still releasing services belonging to this Agent.
    await Promise.all([...this.pendingClosures].filter(([, id]) => id === agentId).map(([closure]) => closure));
  }

  /** Keeps active leases intact while releasing idle model/Pi instances for hidden workspaces. */
  setObserved(observed: boolean): void {
    this.observed = observed;
    this.trimIdleEntries();
  }

  private createRuntime(
    snapshot: AgentSystemRuntimeCacheSnapshot,
    modelProviderId: string | undefined,
    activeAgent?: WorkspaceAgent,
  ): TRuntime {
    const identities = this.options.identityDisplayValues;
    if (activeAgent && !identities) throw new Error("An Agent runtime requires a host identity provider.");
    const dependencies = {
      ...this.runtimeCreationDependencies(),
      ...this.options.agentServices?.(activeAgent),
      ...(activeAgent
        ? {
            activeAgent,
            ...(identities
              ? { identityDisplayValues: () => ({ user: identities().user, assistant: activeAgent.name }) }
              : {}),
          }
        : {}),
    };
    if (this.options.runtimeFactory) {
      return this.options.runtimeFactory({
        ...dependencies,
        snapshot,
        modelProviderId,
      });
    }

    return AgentSystemRuntime.fromConfig({
      ...dependencies,
      config: snapshot.config,
      modelProviderId,
    }) as unknown as TRuntime;
  }

  private runtimeCreationDependencies(): AgentSystemRuntimeCreationDependencies {
    const {
      snapshot: _snapshot,
      maxIdleEntries: _maxIdleEntries,
      runtimeFactory: _runtimeFactory,
      agentServices: _agentServices,
      ...dependencies
    } = this.options;
    return dependencies;
  }

  private createLease(entry: RuntimeCacheEntry<TRuntime>): AgentSystemRuntimeLease<TRuntime> {
    let released = false;
    return {
      fingerprint: entry.fingerprint,
      preparationFingerprint: entry.preparationFingerprint,
      runtime: entry.runtime,
      release: () => {
        if (released) {
          return;
        }

        released = true;
        entry.leases = Math.max(0, entry.leases - 1);
        if (entry.state === "failed") {
          this.closeEntry(entry);
          return;
        }
        if (this.entries.get(entry.fingerprint) === entry) {
          this.trimIdleEntries();
        }
      },
    };
  }

  private initializeEntry(entry: RuntimeCacheEntry<TRuntime>): void {
    if (!entry.runtime.initialize) {
      this.publishEntry(entry);
      return;
    }

    entry.state = "initializing";
    let initialization: void | Promise<void>;
    try {
      initialization = entry.runtime.initialize();
    } catch (error) {
      entry.leases = 0;
      this.rejectEntry(entry, error);
      throw error;
    }
    void Promise.resolve(initialization).then(
      () => this.publishEntry(entry),
      (error) => this.rejectEntry(entry, error),
    );
  }

  private publishEntry(entry: RuntimeCacheEntry<TRuntime>): void {
    if (entry.state === "failed" || this.entries.get(entry.fingerprint) !== entry) return;
    entry.state = "ready";
    this.evictSupersededIdleEntries(entry);
    this.trimIdleEntries();
  }

  private rejectEntry(entry: RuntimeCacheEntry<TRuntime>, error: unknown): void {
    if (entry.state === "failed") return;
    entry.state = "failed";
    if (this.entries.get(entry.fingerprint) === entry) this.entries.delete(entry.fingerprint);
    this.options.logger?.warn("runtime_cache.initialize.failed", { error, fingerprint: entry.fingerprint });
    if (entry.leases === 0) this.closeEntry(entry);
  }

  private evictSupersededIdleEntries(current: RuntimeCacheEntry<TRuntime>): void {
    for (const [fingerprint, entry] of this.entries) {
      if (entry === current || entry.leases > 0 || entry.state !== "ready") continue;

      this.closeEntry(entry);
      this.entries.delete(fingerprint);
    }
  }

  private trimIdleEntries(): void {
    const idleEntries = [...this.entries.values()]
      .filter((entry) => entry.leases === 0 && entry.state === "ready")
      .sort((left, right) => right.lastAccess - left.lastAccess);
    for (const entry of idleEntries.slice(this.observed ? this.maxIdleEntries : 0)) {
      this.closeEntry(entry);
      this.entries.delete(entry.fingerprint);
    }
  }

  private nextAccessSequence(): number {
    this.accessSequence += 1;
    return this.accessSequence;
  }

  private closeEntry(entry: RuntimeCacheEntry<TRuntime>): void {
    if (entry.closing) return;
    entry.closing = true;
    void this.beginRuntimeClose(entry).catch((error) => {
      this.options.logger?.warn("runtime_cache.close.failed", { error });
    });
  }

  private beginRuntimeClose(entry: RuntimeCacheEntry<TRuntime>): Promise<void> {
    if (entry.closePromise) return entry.closePromise;
    let closure: Promise<void>;
    try {
      closure = Promise.resolve(entry.runtime.close());
    } catch (error) {
      closure = Promise.reject(error);
    }
    entry.closePromise = closure;
    this.pendingClosures.set(closure, entry.agentId);
    void closure.then(
      () => this.pendingClosures.delete(closure),
      () => undefined,
    );
    return closure;
  }
}

function runtimeCacheKey(modelProviderId: string | undefined): string {
  return modelProviderId?.trim() || "<default>";
}

function runtimeFingerprint(
  snapshot: AgentSystemRuntimeCacheSnapshot,
  modelProviderId: string | undefined,
  workspaceRoot: string,
  configPath: string,
): string {
  return JSON.stringify([
    workspaceRoot,
    configPath,
    snapshot.version,
    snapshot.revision ?? "json",
    stableSourceRevisions(snapshot.sourceRevisions),
    runtimeCacheKey(modelProviderId),
  ]);
}

function stableSourceRevisions(
  revisions: AgentSystemRuntimeCacheSnapshot["sourceRevisions"],
): ReadonlyArray<readonly [string, string | number]> {
  return Object.entries(revisions ?? {}).sort(([left], [right]) => left.localeCompare(right));
}

function normalizeMaxIdleEntries(value: number | undefined): number {
  if (value === undefined) {
    return 1;
  }

  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 1;
}
