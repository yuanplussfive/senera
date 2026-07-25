import {
  AgentSandboxRuntimeProviders,
  type AgentSandboxPreparationProgress,
  type AgentSandboxRuntimeProvider,
  type AgentSandboxRuntimeState,
  type AgentSandboxRuntimeSnapshot,
} from "./AgentSandboxRuntimeTypes.js";
import { selectAgentSandboxProvider } from "./AgentSandboxProviderSelection.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { resolveSandboxRuntimeConfig } from "../AgentDefaults.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import {
  prepareAgentSandboxRuntime,
  resolveAgentSandboxRuntimePaths,
  type AgentSandboxRuntimePreparationOptions,
  type AgentSandboxRuntimePreparationResult,
} from "./AgentSandboxRuntimePreparation.js";
import type { ResolvedAgentSandboxRuntimeConfig } from "../Types/AgentConfigTypes.js";
import type { SeneraGvisorWorkerClient } from "../Execution/SeneraGvisorTypes.js";
import { AgentGvisorWorkerSocketClient } from "./Gvisor/AgentGvisorWorkerClient.js";
import {
  prepareAgentGvisorRuntime,
  resolveAgentGvisorWorkerSocketPath,
} from "./Gvisor/AgentGvisorRuntimePreparation.js";

export interface AgentSandboxRuntimePreparationStatus {
  state: AgentSandboxRuntimeState;
  message?: string;
  error?: string;
  progress?: AgentSandboxPreparationProgress;
  updatedAt?: string;
}

export type AgentSandboxRuntimePrepareOptions = Omit<
  AgentSandboxRuntimePreparationOptions,
  "workspaceRoot" | "config" | "onProgress"
> & {
  config?: ResolvedAgentSandboxRuntimeConfig;
  gvisorWorker?: SeneraGvisorWorkerClient;
  dockerEngineWorker?: SeneraGvisorWorkerClient;
};

export interface AgentSandboxRuntimeServiceOptions {
  workspaceRoot?: string;
  configSnapshot?: () => AgentSystemConfig;
  sandboxBundleRoot?: string;
  platform?: NodeJS.Platform;
  clock?: () => Date;
  packageAvailable?: () => boolean;
  progressUpdateIntervalMs?: number;
  provider?: AgentSandboxRuntimeProvider;
  dockerEngineWorker?: SeneraGvisorWorkerClient;
}

export class AgentSandboxRuntimeService {
  private readonly workspaceRoot: string;
  private readonly configSnapshot: (() => AgentSystemConfig) | undefined;
  private readonly sandboxBundleRoot: string | undefined;
  private readonly platform: NodeJS.Platform;
  private readonly clock: () => Date;
  private readonly packageAvailable: () => boolean;
  private readonly progressUpdateIntervalMs: number;
  private readonly provider: AgentSandboxRuntimeProvider;
  private gvisorWorker: SeneraGvisorWorkerClient | undefined;
  private readonly listeners = new Set<(snapshot: AgentSandboxRuntimeSnapshot) => void>();
  private preparationPromise: Promise<AgentSandboxRuntimePreparationResult | undefined> | undefined;
  private lastProgressPublicationAt = Number.NEGATIVE_INFINITY;
  private preparationStatus: AgentSandboxRuntimePreparationStatus = {
    state: "unknown",
  };

  constructor(options: AgentSandboxRuntimeServiceOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.configSnapshot = options.configSnapshot;
    this.sandboxBundleRoot = options.sandboxBundleRoot;
    this.platform = options.platform ?? process.platform;
    this.clock = options.clock ?? (() => new Date());
    this.packageAvailable = options.packageAvailable ?? resolveMicrosandboxPackageAvailable;
    this.progressUpdateIntervalMs = options.progressUpdateIntervalMs ?? 200;
    this.provider =
      options.provider ??
      selectAgentSandboxProvider({
        preference: this.runtimeConfig()?.Provider ?? "auto",
        platform: this.platform,
      });
    this.gvisorWorker = options.dockerEngineWorker;
  }

  snapshot(): AgentSandboxRuntimeSnapshot {
    const runtimeConfig = this.runtimeConfig();
    const enabled = runtimeConfig?.Enabled ?? true;
    const supported = this.provider !== AgentSandboxRuntimeProviders.Microsandbox || this.packageAvailable();
    const pathResolution = enabled ? this.runtimePaths(runtimeConfig) : { paths: undefined };
    const state = enabled
      ? supported && !pathResolution.error
        ? this.preparationStatus.state
        : "unavailable"
      : "disabled";
    const unavailableError = pathResolution.error ?? this.preparationStatus.error;
    const effectiveMode =
      state === "disabled" ? "disabled" : supported && state === "ready" ? "sandbox" : "unavailable";
    const diagnostics = this.diagnostics(supported, state, unavailableError);
    return {
      provider: this.provider,
      platform: this.platform,
      state,
      supported,
      effectiveMode,
      paths: pathResolution.paths,
      progress: state === "preparing" ? this.preparationStatus.progress : undefined,
      dependencies: {
        errors: this.dependencyErrors(supported, state, unavailableError),
        warnings: this.dependencyWarnings(supported, state),
      },
      diagnostics,
      message: this.message(supported, state),
      updatedAt: this.clock().toISOString(),
    };
  }

  runtimeProvider(): AgentSandboxRuntimeProvider {
    return this.provider;
  }

  gvisorWorkerClient(): SeneraGvisorWorkerClient | undefined {
    if (
      this.provider !== AgentSandboxRuntimeProviders.Gvisor &&
      this.provider !== AgentSandboxRuntimeProviders.DockerEngine
    ) {
      return undefined;
    }
    const config = this.runtimeConfig();
    if (!config) return undefined;
    return (this.gvisorWorker ??= new AgentGvisorWorkerSocketClient({
      socketPath: resolveAgentGvisorWorkerSocketPath(this.workspaceRoot, config),
    }));
  }

  markPreparing(message = agentErrorMessage("sandbox.preparing.statusMessage")): void {
    this.setPreparing(message);
  }

  reportProgress(progress: AgentSandboxPreparationProgress): void {
    this.setPreparing(agentErrorMessage("sandbox.preparing.statusMessage"), progress, true);
  }

  async prepare(
    options: AgentSandboxRuntimePrepareOptions = {},
  ): Promise<AgentSandboxRuntimePreparationResult | undefined> {
    if (this.preparationPromise) {
      return this.preparationPromise;
    }

    const config = options.config ?? this.runtimeConfig();
    if (!config) {
      throw new Error("Sandbox runtime preparation requires a resolved runtime configuration.");
    }
    if (!config.Enabled) {
      this.markDisabled();
      return undefined;
    }

    this.markPreparing();
    const preparation =
      this.provider === AgentSandboxRuntimeProviders.Gvisor ||
      this.provider === AgentSandboxRuntimeProviders.DockerEngine
        ? prepareAgentGvisorRuntime({
            workspaceRoot: this.workspaceRoot,
            config,
            worker: options.gvisorWorker ?? options.dockerEngineWorker ?? this.gvisorWorkerClient()!,
            expectedProvider: this.provider,
            onProgress: (progress) => this.reportProgress(progress),
          })
        : prepareAgentSandboxRuntime({
            ...options,
            workspaceRoot: this.workspaceRoot,
            config,
            sandboxBundleRoot: options.sandboxBundleRoot ?? this.sandboxBundleRoot,
            onProgress: (progress) => this.reportProgress(progress),
          });
    this.preparationPromise = preparation.then(
      (result) => {
        this.markReady();
        return result;
      },
      (error: unknown) => {
        this.markUnavailable(error);
        throw error;
      },
    );
    try {
      return await this.preparationPromise;
    } finally {
      this.preparationPromise = undefined;
    }
  }

  subscribe(listener: (snapshot: AgentSandboxRuntimeSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setPreparing(message: string, progress?: AgentSandboxPreparationProgress, throttle = false): void {
    const previousProgress = this.preparationStatus.progress;
    this.preparationStatus = {
      state: "preparing",
      message,
      progress,
      updatedAt: this.clock().toISOString(),
    };
    if (
      throttle &&
      previousProgress?.stage === progress?.stage &&
      this.clock().getTime() - this.lastProgressPublicationAt < this.progressUpdateIntervalMs
    ) {
      return;
    }
    this.publish();
  }

  markReady(message = agentErrorMessage("sandbox.ready.statusMessage")): void {
    this.preparationStatus = {
      state: "ready",
      message,
      updatedAt: this.clock().toISOString(),
    };
    this.publish();
  }

  markUnavailable(error: unknown, message = agentErrorMessage("sandbox.unavailable.statusMessage")): void {
    this.preparationStatus = {
      state: "unavailable",
      message,
      error: errorMessage(error),
      updatedAt: this.clock().toISOString(),
    };
    this.publish();
  }

  markDisabled(message = agentErrorMessage("sandbox.disabled.statusMessage")): void {
    this.preparationStatus = {
      state: "disabled",
      message,
      updatedAt: this.clock().toISOString(),
    };
    this.publish();
  }

  private publish(): void {
    this.lastProgressPublicationAt = this.clock().getTime();
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private runtimeConfig() {
    const config = this.configSnapshot?.();
    return config ? resolveSandboxRuntimeConfig(config) : undefined;
  }

  private runtimePaths(runtimeConfig = this.runtimeConfig()): {
    paths: AgentSandboxRuntimeSnapshot["paths"];
    error?: string;
  } {
    if (!runtimeConfig) {
      return { paths: undefined };
    }
    try {
      return { paths: resolveAgentSandboxRuntimePaths(this.workspaceRoot, runtimeConfig) };
    } catch (error) {
      return { paths: undefined, error: errorMessage(error) };
    }
  }

  private dependencyErrors(
    supported: boolean,
    state: AgentSandboxRuntimeState,
    unavailableError: string | undefined,
  ): string[] {
    if (state === "disabled") {
      return [];
    }
    if (!supported) {
      return ["microsandbox package is not resolvable"];
    }
    if (state === "unavailable" && unavailableError) {
      return [unavailableError];
    }
    return [];
  }

  private dependencyWarnings(supported: boolean, state: AgentSandboxRuntimeState): string[] {
    if (state === "disabled") {
      return [];
    }
    if (!supported) {
      return [];
    }
    if (state === "unknown") {
      return [`${this.provider} host runtime has not been checked yet`];
    }
    if (state === "preparing") {
      return [`${this.provider} host runtime is being prepared`];
    }
    if (state === "unavailable") {
      return ["tools selected for the sandbox boundary cannot run until the sandbox runtime is available"];
    }
    return [];
  }

  private diagnostics(
    supported: boolean,
    state: AgentSandboxRuntimeState,
    unavailableError: string | undefined,
  ): AgentSandboxRuntimeSnapshot["diagnostics"] {
    if (state === "disabled") {
      return [sandboxDisabledDiagnostic(this.provider)];
    }
    if (!supported) {
      return [microsandboxMissingDiagnostic()];
    }
    if (state === "ready") {
      return [sandboxReadyDiagnostic(this.provider)];
    }
    if (state === "preparing") {
      return [sandboxPreparingDiagnostic(this.provider)];
    }
    if (state === "unavailable") {
      return [sandboxUnavailableDiagnostic(this.provider, unavailableError)];
    }
    return [sandboxConfiguredDiagnostic(this.provider)];
  }

  private message(supported: boolean, state: AgentSandboxRuntimeState): string {
    if (state === "disabled") {
      return this.preparationStatus.message ?? agentErrorMessage("sandbox.disabled.snapshotMessage");
    }
    if (!supported) {
      return agentErrorMessage("sandbox.missing.snapshotMessage");
    }
    if (state === "ready") {
      return this.preparationStatus.message ?? agentErrorMessage("sandbox.ready.statusMessage");
    }
    if (state === "preparing") {
      return this.preparationStatus.message ?? agentErrorMessage("sandbox.preparing.statusMessage");
    }
    if (state === "unavailable") {
      return this.preparationStatus.message ?? agentErrorMessage("sandbox.unavailable.snapshotMessage");
    }
    return agentErrorMessage("sandbox.configured.snapshotMessage");
  }
}

function sandboxDisabledDiagnostic(
  provider: AgentSandboxRuntimeProvider,
): AgentSandboxRuntimeSnapshot["diagnostics"][number] {
  return {
    code: `${provider}_disabled_by_runtime_configuration`,
    severity: "warning",
    message: agentErrorMessage("sandbox.disabled.message"),
    recommendation: agentErrorMessage("sandbox.disabled.recommendation"),
    details: [agentErrorMessage("sandbox.disabled.detail.localOnly")],
  };
}

function sandboxConfiguredDiagnostic(
  provider: AgentSandboxRuntimeProvider,
): AgentSandboxRuntimeSnapshot["diagnostics"][number] {
  return {
    code: `${provider}_backend_configured`,
    severity: "warning",
    message: agentErrorMessage("sandbox.configured.message"),
    recommendation: agentErrorMessage("sandbox.configured.recommendation"),
    details: [
      agentErrorMessage("sandbox.configured.detail.readOnlyWorkspace"),
      agentErrorMessage("sandbox.configured.detail.networkPolicy"),
      ...(provider === AgentSandboxRuntimeProviders.Microsandbox
        ? [agentErrorMessage("sandbox.configured.detail.uacNotUsed")]
        : []),
    ],
  };
}

function sandboxPreparingDiagnostic(
  provider: AgentSandboxRuntimeProvider,
): AgentSandboxRuntimeSnapshot["diagnostics"][number] {
  return {
    code: `${provider}_runtime_preparing`,
    severity: "warning",
    message: agentErrorMessage("sandbox.preparing.message"),
    recommendation: agentErrorMessage("sandbox.preparing.recommendation"),
    details: [
      agentErrorMessage("sandbox.preparing.detail.desktopStartup"),
      ...(provider === AgentSandboxRuntimeProviders.Microsandbox
        ? [agentErrorMessage("sandbox.preparing.detail.localBundleRequired")]
        : []),
    ],
  };
}

function sandboxReadyDiagnostic(
  provider: AgentSandboxRuntimeProvider,
): AgentSandboxRuntimeSnapshot["diagnostics"][number] {
  return {
    code: `${provider}_runtime_ready`,
    severity: "warning",
    message: agentErrorMessage("sandbox.ready.message"),
    recommendation: agentErrorMessage("sandbox.ready.recommendation"),
    details: [
      agentErrorMessage("sandbox.ready.detail.readOnlyWorkspace"),
      agentErrorMessage("sandbox.ready.detail.networkPolicy"),
    ],
  };
}

function sandboxUnavailableDiagnostic(
  provider: AgentSandboxRuntimeProvider,
  error: string | undefined,
): AgentSandboxRuntimeSnapshot["diagnostics"][number] {
  return {
    code: `${provider}_runtime_unavailable`,
    severity: "error",
    message: agentErrorMessage("sandbox.unavailable.message"),
    recommendation: agentErrorMessage("sandbox.unavailable.recommendation"),
    details: [
      agentErrorMessage("sandbox.unavailable.detail.selectedSandboxTools"),
      ...(provider === AgentSandboxRuntimeProviders.Microsandbox
        ? [agentErrorMessage("sandbox.unavailable.detail.windowsVirtualization")]
        : []),
      ...(error ? [agentErrorMessage("sandbox.unavailable.detail.lastError", { error })] : []),
    ],
  };
}

function microsandboxMissingDiagnostic(): AgentSandboxRuntimeSnapshot["diagnostics"][number] {
  return {
    code: "microsandbox_package_missing",
    severity: "warning",
    message: agentErrorMessage("sandbox.missing.message"),
    recommendation: agentErrorMessage("sandbox.missing.recommendation"),
    details: [agentErrorMessage("sandbox.unavailable.detail.selectedSandboxTools")],
  };
}

function resolveMicrosandboxPackageAvailable(): boolean {
  try {
    import.meta.resolve("microsandbox");
    return true;
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
