import type { AgentApprovalRuntime } from "../Approvals/AgentApprovalRuntime.js";
import type { AgentLogger } from "../Diagnostics/AgentLogger.js";
import type { AgentPiActiveSessionRegistry } from "../Pi/AgentPiActiveSessionRegistry.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { AgentSystemRuntime } from "./AgentSystemRuntime.js";
import type { AgentExecutionResourceBroker } from "../ExecutionResources/AgentExecutionResourceBroker.js";
import type { AgentInteractionInputRuntime } from "../Interaction/AgentInteractionInputRuntime.js";
import { createAgentRuntimePreparationFingerprint } from "./AgentRuntimePreparationFingerprint.js";
import type { AgentPiDiagnosticSink } from "../Pi/AgentPiDiagnostics.js";
import type { SeneraMicrosandboxSdkAdapter } from "../Execution/SeneraMicrosandboxTypes.js";
import type { SeneraGvisorWorkerClient } from "../Execution/SeneraGvisorTypes.js";
import type { AgentSandboxRuntimeProvider } from "../Sandbox/AgentSandboxRuntimeTypes.js";
import type { AgentExtensionValueResolver } from "../Extensions/AgentExtensionValueExpression.js";
import type { AgentPiTurnContextStore } from "../PiShared/AgentPiTurnContext.js";
import type { AgentWorkspaceRuntimeServices } from "./AgentWorkspaceRuntime.js";

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

export interface AgentSystemRuntimeCacheRuntimeFactoryInput {
  workspaceRoot: string;
  configPath: string;
  snapshot: AgentSystemRuntimeCacheSnapshot;
  modelProviderId?: string;
  logger?: AgentLogger;
  piDiagnostics?: AgentPiDiagnosticSink;
  approvalRuntime?: AgentApprovalRuntime;
  interactionInput?: AgentInteractionInputRuntime;
  piSessionRegistry?: AgentPiActiveSessionRegistry;
  resourcesPath?: string;
  executionResources?: AgentExecutionResourceBroker;
  sandboxRuntimeReady?: () => boolean;
  microsandboxSdk?: SeneraMicrosandboxSdkAdapter;
  sandboxProvider?: AgentSandboxRuntimeProvider;
  gvisorWorker?: SeneraGvisorWorkerClient;
  mcpInputs?: AgentExtensionValueResolver;
  piTurnContexts?: AgentPiTurnContextStore;
  workspaceRuntime?: AgentWorkspaceRuntimeServices;
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
  piDiagnostics?: AgentPiDiagnosticSink;
  approvalRuntime?: AgentApprovalRuntime;
  interactionInput?: AgentInteractionInputRuntime;
  piSessionRegistry?: AgentPiActiveSessionRegistry;
  resourcesPath?: string;
  executionResources?: AgentExecutionResourceBroker;
  sandboxRuntimeReady?: () => boolean;
  microsandboxSdk?: SeneraMicrosandboxSdkAdapter;
  sandboxProvider?: AgentSandboxRuntimeProvider;
  gvisorWorker?: SeneraGvisorWorkerClient;
  mcpInputs?: AgentExtensionValueResolver;
  piTurnContexts?: AgentPiTurnContextStore;
  workspaceRuntime?: AgentWorkspaceRuntimeServices;
  maxIdleEntries?: number;
  runtimeFactory?: (input: AgentSystemRuntimeCacheRuntimeFactoryInput) => TRuntime;
}

interface RuntimeCacheEntry<TRuntime extends AgentSystemRuntimeCacheRuntime> {
  readonly fingerprint: string;
  readonly preparationFingerprint: string;
  readonly runtime: TRuntime;
  state: "initializing" | "ready" | "failed";
  closing: boolean;
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
      entry = {
        fingerprint,
        preparationFingerprint: createAgentRuntimePreparationFingerprint({
          config: snapshot.config,
          modelProviderId,
          sourceRevisions: snapshot.sourceRevisions,
        }),
        runtime: this.createRuntime(snapshot, modelProviderId),
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
        piDiagnostics: this.options.piDiagnostics,
        approvalRuntime: this.options.approvalRuntime,
        interactionInput: this.options.interactionInput,
        piSessionRegistry: this.options.piSessionRegistry,
        resourcesPath: this.options.resourcesPath,
        executionResources: this.options.executionResources,
        sandboxRuntimeReady: this.options.sandboxRuntimeReady,
        microsandboxSdk: this.options.microsandboxSdk,
        sandboxProvider: this.options.sandboxProvider,
        gvisorWorker: this.options.gvisorWorker,
        mcpInputs: this.options.mcpInputs,
        piTurnContexts: this.options.piTurnContexts,
        workspaceRuntime: this.options.workspaceRuntime,
      });
    }

    return AgentSystemRuntime.fromConfig({
      workspaceRoot: this.options.workspaceRoot,
      configPath: this.options.configPath,
      config: snapshot.config,
      modelProviderId,
      logger: this.options.logger,
      piDiagnostics: this.options.piDiagnostics,
      approvalRuntime: this.options.approvalRuntime,
      interactionInput: this.options.interactionInput,
      piSessionRegistry: this.options.piSessionRegistry,
      resourcesPath: this.options.resourcesPath,
      executionResources: this.options.executionResources,
      sandboxRuntimeReady: this.options.sandboxRuntimeReady,
      microsandboxSdk: this.options.microsandboxSdk,
      sandboxProvider: this.options.sandboxProvider,
      gvisorWorker: this.options.gvisorWorker,
      mcpInputs: this.options.mcpInputs,
      piTurnContexts: this.options.piTurnContexts,
      workspaceRuntime: this.options.workspaceRuntime,
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
    for (const entry of idleEntries.slice(this.maxIdleEntries)) {
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
    void this.beginRuntimeClose(entry.runtime).catch((error) => {
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
