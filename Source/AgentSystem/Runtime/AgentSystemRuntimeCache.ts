import type { AgentApprovalRuntime } from "../Approvals/AgentApprovalRuntime.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { AgentPiActiveSessionRegistry } from "../Pi/AgentPiActiveSessionRegistry.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { AgentSystemRuntime } from "./AgentSystemRuntime.js";
import type { AgentExecutionResourceBroker } from "../ExecutionResources/AgentExecutionResourceBroker.js";
import type { AgentInteractionInputRuntime } from "../Interaction/AgentInteractionInputRuntime.js";
import { createAgentRuntimePreparationFingerprint } from "./AgentRuntimePreparationFingerprint.js";
import type { AgentMcpRuntimeModuleResolver } from "../Mcp/AgentMcpRuntimeModuleResolver.js";

export interface AgentSystemRuntimeCacheSnapshot {
  version: number;
  revision?: number;
  sourceRevisions?: Readonly<Record<string, string | number>>;
  config: AgentSystemConfig;
}

export interface AgentSystemRuntimeCacheRuntime {
  close(): void | Promise<void>;
}

export interface AgentSystemRuntimeCacheRuntimeFactoryInput {
  workspaceRoot: string;
  configPath: string;
  snapshot: AgentSystemRuntimeCacheSnapshot;
  modelProviderId?: string;
  logger?: AgentLogger;
  approvalRuntime?: AgentApprovalRuntime;
  interactionInput?: AgentInteractionInputRuntime;
  piSessionRegistry?: AgentPiActiveSessionRegistry;
  resourcesPath?: string;
  runtimeModuleResolver?: AgentMcpRuntimeModuleResolver;
  executionResources?: AgentExecutionResourceBroker;
}

export interface AgentSystemRuntimeLease<TRuntime extends AgentSystemRuntimeCacheRuntime> {
  readonly fingerprint: string;
  readonly preparationFingerprint: string;
  readonly runtime: TRuntime;
  release(): void;
}

export interface AgentSystemRuntimeCacheOptions<TRuntime extends AgentSystemRuntimeCacheRuntime = AgentSystemRuntime> {
  workspaceRoot: string;
  configPath: string;
  snapshot: () => AgentSystemRuntimeCacheSnapshot;
  logger?: AgentLogger;
  approvalRuntime?: AgentApprovalRuntime;
  interactionInput?: AgentInteractionInputRuntime;
  piSessionRegistry?: AgentPiActiveSessionRegistry;
  resourcesPath?: string;
  runtimeModuleResolver?: AgentMcpRuntimeModuleResolver;
  executionResources?: AgentExecutionResourceBroker;
  maxIdleEntries?: number;
  runtimeFactory?: (input: AgentSystemRuntimeCacheRuntimeFactoryInput) => TRuntime;
}

interface RuntimeCacheEntry<TRuntime extends AgentSystemRuntimeCacheRuntime> {
  readonly fingerprint: string;
  readonly preparationFingerprint: string;
  readonly runtime: TRuntime;
  leases: number;
  lastAccess: number;
}

export class AgentSystemRuntimeCache<TRuntime extends AgentSystemRuntimeCacheRuntime = AgentSystemRuntime> {
  private readonly entries = new Map<string, RuntimeCacheEntry<TRuntime>>();
  private readonly pendingClosures = new Set<Promise<void>>();
  private readonly maxIdleEntries: number;
  private accessSequence = 0;

  constructor(private readonly options: AgentSystemRuntimeCacheOptions<TRuntime>) {
    this.maxIdleEntries = normalizeMaxIdleEntries(options.maxIdleEntries);
  }

  acquire(modelProviderId?: string): AgentSystemRuntimeLease<TRuntime> {
    const snapshot = this.options.snapshot();
    const fingerprint = runtimeFingerprint(snapshot, modelProviderId);
    let entry = this.entries.get(fingerprint);
    if (!entry) {
      // Start closing idle generations before a new heavyweight runtime is constructed.
      this.evictIdleEntries();
      entry = {
        fingerprint,
        preparationFingerprint: createAgentRuntimePreparationFingerprint({
          config: snapshot.config,
          modelProviderId,
          sourceRevisions: snapshot.sourceRevisions,
        }),
        runtime: this.createRuntime(snapshot, modelProviderId),
        leases: 0,
        lastAccess: 0,
      };
      this.entries.set(fingerprint, entry);
    }

    entry.leases += 1;
    entry.lastAccess = this.nextAccessSequence();
    return this.createLease(entry);
  }

  async clear(): Promise<void> {
    for (const entry of this.entries.values()) {
      void this.beginRuntimeClose(entry.runtime).catch(() => undefined);
    }
    this.entries.clear();
    const outcomes = await Promise.allSettled([...this.pendingClosures]);
    const failures = outcomes.flatMap((outcome) => (outcome.status === "rejected" ? [outcome.reason] : []));
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Runtime cache shutdown failed.");
  }

  private createRuntime(snapshot: AgentSystemRuntimeCacheSnapshot, modelProviderId: string | undefined): TRuntime {
    if (this.options.runtimeFactory) {
      return this.options.runtimeFactory({
        workspaceRoot: this.options.workspaceRoot,
        configPath: this.options.configPath,
        snapshot,
        modelProviderId,
        logger: this.options.logger,
        approvalRuntime: this.options.approvalRuntime,
        interactionInput: this.options.interactionInput,
        piSessionRegistry: this.options.piSessionRegistry,
        resourcesPath: this.options.resourcesPath,
        runtimeModuleResolver: this.options.runtimeModuleResolver,
        executionResources: this.options.executionResources,
      });
    }

    return AgentSystemRuntime.fromConfig({
      workspaceRoot: this.options.workspaceRoot,
      configPath: this.options.configPath,
      config: snapshot.config,
      modelProviderId,
      logger: this.options.logger,
      approvalRuntime: this.options.approvalRuntime,
      interactionInput: this.options.interactionInput,
      piSessionRegistry: this.options.piSessionRegistry,
      resourcesPath: this.options.resourcesPath,
      runtimeModuleResolver: this.options.runtimeModuleResolver,
      executionResources: this.options.executionResources,
    }) as unknown as TRuntime;
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
        if (this.entries.get(entry.fingerprint) === entry) {
          this.trimIdleEntries();
        }
      },
    };
  }

  private evictIdleEntries(): void {
    for (const [fingerprint, entry] of this.entries) {
      if (entry.leases > 0) {
        continue;
      }

      this.closeEvictedRuntime(entry.runtime);
      this.entries.delete(fingerprint);
    }
  }

  private trimIdleEntries(): void {
    const idleEntries = [...this.entries.values()]
      .filter((entry) => entry.leases === 0)
      .sort((left, right) => right.lastAccess - left.lastAccess);
    for (const entry of idleEntries.slice(this.maxIdleEntries)) {
      this.closeEvictedRuntime(entry.runtime);
      this.entries.delete(entry.fingerprint);
    }
  }

  private nextAccessSequence(): number {
    this.accessSequence += 1;
    return this.accessSequence;
  }

  private closeEvictedRuntime(runtime: TRuntime): void {
    void this.beginRuntimeClose(runtime).catch((error) => {
      this.options.logger?.warn("runtime_cache.close.failed", { error });
    });
  }

  private beginRuntimeClose(runtime: TRuntime): Promise<void> {
    let closure: Promise<void>;
    try {
      closure = Promise.resolve(runtime.close());
    } catch (error) {
      closure = Promise.reject(error);
    }
    this.pendingClosures.add(closure);
    void closure.then(
      () => this.pendingClosures.delete(closure),
      () => this.pendingClosures.delete(closure),
    );
    return closure;
  }
}

function runtimeCacheKey(modelProviderId: string | undefined): string {
  return modelProviderId?.trim() || "<default>";
}

function runtimeFingerprint(snapshot: AgentSystemRuntimeCacheSnapshot, modelProviderId: string | undefined): string {
  return JSON.stringify([
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
