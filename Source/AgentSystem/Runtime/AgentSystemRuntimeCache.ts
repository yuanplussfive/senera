import type { AgentApprovalRuntime } from "../Approvals/AgentApprovalRuntime.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { AgentPiActiveSessionRegistry } from "../Pi/AgentPiActiveSessionRegistry.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { AgentSystemRuntime } from "./AgentSystemRuntime.js";

export interface AgentSystemRuntimeCacheSnapshot {
  version: number;
  revision?: number;
  config: AgentSystemConfig;
}

export interface AgentSystemRuntimeCacheRuntime {
  close(): void;
}

export interface AgentSystemRuntimeCacheRuntimeFactoryInput {
  workspaceRoot: string;
  configPath: string;
  snapshot: AgentSystemRuntimeCacheSnapshot;
  modelProviderId?: string;
  logger?: AgentLogger;
  approvalRuntime?: AgentApprovalRuntime;
  piSessionRegistry?: AgentPiActiveSessionRegistry;
  resourcesPath?: string;
}

export interface AgentSystemRuntimeLease<TRuntime extends AgentSystemRuntimeCacheRuntime> {
  readonly runtime: TRuntime;
  release(): void;
}

export interface AgentSystemRuntimeCacheOptions<TRuntime extends AgentSystemRuntimeCacheRuntime = AgentSystemRuntime> {
  workspaceRoot: string;
  configPath: string;
  snapshot: () => AgentSystemRuntimeCacheSnapshot;
  logger?: AgentLogger;
  approvalRuntime?: AgentApprovalRuntime;
  piSessionRegistry?: AgentPiActiveSessionRegistry;
  resourcesPath?: string;
  maxIdleEntries?: number;
  runtimeFactory?: (input: AgentSystemRuntimeCacheRuntimeFactoryInput) => TRuntime;
}

interface RuntimeCacheEntry<TRuntime extends AgentSystemRuntimeCacheRuntime> {
  readonly fingerprint: string;
  readonly runtime: TRuntime;
  leases: number;
  lastAccess: number;
}

export class AgentSystemRuntimeCache<TRuntime extends AgentSystemRuntimeCacheRuntime = AgentSystemRuntime> {
  private readonly entries = new Map<string, RuntimeCacheEntry<TRuntime>>();
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
      // Close idle generations before a new heavyweight runtime is constructed.
      this.evictIdleEntries();
      entry = {
        fingerprint,
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

  clear(): void {
    for (const entry of this.entries.values()) {
      entry.runtime.close();
    }
    this.entries.clear();
  }

  private createRuntime(
    snapshot: AgentSystemRuntimeCacheSnapshot,
    modelProviderId: string | undefined,
  ): TRuntime {
    if (this.options.runtimeFactory) {
      return this.options.runtimeFactory({
        workspaceRoot: this.options.workspaceRoot,
        configPath: this.options.configPath,
        snapshot,
        modelProviderId,
        logger: this.options.logger,
        approvalRuntime: this.options.approvalRuntime,
        piSessionRegistry: this.options.piSessionRegistry,
        resourcesPath: this.options.resourcesPath,
      });
    }

    return AgentSystemRuntime.fromConfig({
      workspaceRoot: this.options.workspaceRoot,
      configPath: this.options.configPath,
      config: snapshot.config,
      modelProviderId,
      logger: this.options.logger,
      approvalRuntime: this.options.approvalRuntime,
      piSessionRegistry: this.options.piSessionRegistry,
      resourcesPath: this.options.resourcesPath,
    }) as unknown as TRuntime;
  }

  private createLease(entry: RuntimeCacheEntry<TRuntime>): AgentSystemRuntimeLease<TRuntime> {
    let released = false;
    return {
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

      entry.runtime.close();
      this.entries.delete(fingerprint);
    }
  }

  private trimIdleEntries(): void {
    const idleEntries = [...this.entries.values()]
      .filter((entry) => entry.leases === 0)
      .sort((left, right) => right.lastAccess - left.lastAccess);
    for (const entry of idleEntries.slice(this.maxIdleEntries)) {
      entry.runtime.close();
      this.entries.delete(entry.fingerprint);
    }
  }

  private nextAccessSequence(): number {
    this.accessSequence += 1;
    return this.accessSequence;
  }
}

function runtimeCacheKey(modelProviderId: string | undefined): string {
  return modelProviderId?.trim() || "<default>";
}

function runtimeFingerprint(
  snapshot: AgentSystemRuntimeCacheSnapshot,
  modelProviderId: string | undefined,
): string {
  return JSON.stringify([
    snapshot.version,
    snapshot.revision ?? "json",
    runtimeCacheKey(modelProviderId),
  ]);
}

function normalizeMaxIdleEntries(value: number | undefined): number {
  if (value === undefined) {
    return 1;
  }

  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 1;
}
