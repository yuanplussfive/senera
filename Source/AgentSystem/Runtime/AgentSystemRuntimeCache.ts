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

export interface AgentSystemRuntimeCacheOptions {
  workspaceRoot: string;
  configPath: string;
  snapshot: () => AgentSystemRuntimeCacheSnapshot;
  logger?: AgentLogger;
  approvalRuntime?: AgentApprovalRuntime;
  piSessionRegistry?: AgentPiActiveSessionRegistry;
  resourcesPath?: string;
}

interface RuntimeCacheEntry {
  readonly fingerprint: string;
  readonly runtime: AgentSystemRuntime;
}

export class AgentSystemRuntimeCache {
  private readonly entries = new Map<string, RuntimeCacheEntry>();

  constructor(private readonly options: AgentSystemRuntimeCacheOptions) {}

  get(modelProviderId?: string): AgentSystemRuntime {
    const snapshot = this.options.snapshot();
    const cacheKey = runtimeCacheKey(modelProviderId);
    const fingerprint = runtimeFingerprint(snapshot, modelProviderId);
    const current = this.entries.get(cacheKey);
    if (current?.fingerprint === fingerprint) {
      return current.runtime;
    }

    current?.runtime.close();
    const runtime = AgentSystemRuntime.fromConfig({
      workspaceRoot: this.options.workspaceRoot,
      configPath: this.options.configPath,
      config: snapshot.config,
      modelProviderId,
      logger: this.options.logger,
      approvalRuntime: this.options.approvalRuntime,
      piSessionRegistry: this.options.piSessionRegistry,
      resourcesPath: this.options.resourcesPath,
    });
    this.entries.set(cacheKey, {
      fingerprint,
      runtime,
    });
    return runtime;
  }

  clear(): void {
    for (const entry of this.entries.values()) {
      entry.runtime.close();
    }
    this.entries.clear();
  }
}

function runtimeCacheKey(modelProviderId: string | undefined): string {
  return modelProviderId?.trim() || "<default>";
}

function runtimeFingerprint(
  snapshot: AgentSystemRuntimeCacheSnapshot,
  modelProviderId: string | undefined,
): string {
  return [
    snapshot.version,
    snapshot.revision ?? "json",
    runtimeCacheKey(modelProviderId),
  ].join(":");
}
