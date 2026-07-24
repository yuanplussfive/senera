import {
  AgentSandboxRuntimeProvider,
  type AgentSandboxPreparationProgress,
  type AgentSandboxRuntimeState,
  type AgentSandboxRuntimeSnapshot,
} from "./AgentSandboxRuntimeTypes.js";
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
};

export interface AgentSandboxRuntimeServiceOptions {
  workspaceRoot?: string;
  configSnapshot?: () => AgentSystemConfig;
  productVersion?: string;
  platform?: NodeJS.Platform;
  clock?: () => Date;
  packageAvailable?: () => boolean;
  progressUpdateIntervalMs?: number;
}

export class AgentSandboxRuntimeService {
  private readonly workspaceRoot: string;
  private readonly configSnapshot: (() => AgentSystemConfig) | undefined;
  private readonly productVersion: string | undefined;
  private readonly platform: NodeJS.Platform;
  private readonly clock: () => Date;
  private readonly packageAvailable: () => boolean;
  private readonly progressUpdateIntervalMs: number;
  private readonly listeners = new Set<(snapshot: AgentSandboxRuntimeSnapshot) => void>();
  private preparationPromise: Promise<AgentSandboxRuntimePreparationResult | undefined> | undefined;
  private lastProgressPublicationAt = Number.NEGATIVE_INFINITY;
  private preparationStatus: AgentSandboxRuntimePreparationStatus = {
    state: "unknown",
  };

  constructor(options: AgentSandboxRuntimeServiceOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.configSnapshot = options.configSnapshot;
    this.productVersion = options.productVersion;
    this.platform = options.platform ?? process.platform;
    this.clock = options.clock ?? (() => new Date());
    this.packageAvailable = options.packageAvailable ?? resolveMicrosandboxPackageAvailable;
    this.progressUpdateIntervalMs = options.progressUpdateIntervalMs ?? 200;
  }

  snapshot(): AgentSandboxRuntimeSnapshot {
    const runtimeConfig = this.runtimeConfig();
    const enabled = runtimeConfig?.Enabled ?? true;
    const supported = this.packageAvailable();
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
      provider: AgentSandboxRuntimeProvider,
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
    const preparation = prepareAgentSandboxRuntime({
      ...options,
      workspaceRoot: this.workspaceRoot,
      config,
      productVersion: options.productVersion ?? this.productVersion,
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
      return ["microsandbox host runtime has not been checked yet"];
    }
    if (state === "preparing") {
      return ["microsandbox host runtime is being prepared"];
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
      return [microsandboxDisabledDiagnostic()];
    }
    if (!supported) {
      return [microsandboxMissingDiagnostic()];
    }
    if (state === "ready") {
      return [microsandboxReadyDiagnostic()];
    }
    if (state === "preparing") {
      return [microsandboxPreparingDiagnostic()];
    }
    if (state === "unavailable") {
      return [microsandboxUnavailableDiagnostic(unavailableError)];
    }
    return [microsandboxConfiguredDiagnostic()];
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

function microsandboxDisabledDiagnostic(): AgentSandboxRuntimeSnapshot["diagnostics"][number] {
  return {
    code: "microsandbox_disabled_by_runtime_configuration",
    severity: "warning",
    message: agentErrorMessage("sandbox.disabled.message"),
    recommendation: agentErrorMessage("sandbox.disabled.recommendation"),
    details: [agentErrorMessage("sandbox.disabled.detail.localOnly")],
  };
}

function microsandboxConfiguredDiagnostic(): AgentSandboxRuntimeSnapshot["diagnostics"][number] {
  return {
    code: "microsandbox_backend_configured",
    severity: "warning",
    message: agentErrorMessage("sandbox.configured.message"),
    recommendation: agentErrorMessage("sandbox.configured.recommendation"),
    details: [
      agentErrorMessage("sandbox.configured.detail.readOnlyWorkspace"),
      agentErrorMessage("sandbox.configured.detail.sandboxNetworkDenied"),
      agentErrorMessage("sandbox.configured.detail.uacNotUsed"),
    ],
  };
}

function microsandboxPreparingDiagnostic(): AgentSandboxRuntimeSnapshot["diagnostics"][number] {
  return {
    code: "microsandbox_runtime_preparing",
    severity: "warning",
    message: agentErrorMessage("sandbox.preparing.message"),
    recommendation: agentErrorMessage("sandbox.preparing.recommendation"),
    details: [
      agentErrorMessage("sandbox.preparing.detail.desktopStartup"),
      agentErrorMessage("sandbox.preparing.detail.networkMayBeRequired"),
    ],
  };
}

function microsandboxReadyDiagnostic(): AgentSandboxRuntimeSnapshot["diagnostics"][number] {
  return {
    code: "microsandbox_runtime_ready",
    severity: "warning",
    message: agentErrorMessage("sandbox.ready.message"),
    recommendation: agentErrorMessage("sandbox.ready.recommendation"),
    details: [
      agentErrorMessage("sandbox.ready.detail.readOnlyWorkspace"),
      agentErrorMessage("sandbox.ready.detail.networkPolicy"),
    ],
  };
}

function microsandboxUnavailableDiagnostic(
  error: string | undefined,
): AgentSandboxRuntimeSnapshot["diagnostics"][number] {
  return {
    code: "microsandbox_runtime_unavailable",
    severity: "error",
    message: agentErrorMessage("sandbox.unavailable.message"),
    recommendation: agentErrorMessage("sandbox.unavailable.recommendation"),
    details: [
      agentErrorMessage("sandbox.unavailable.detail.selectedSandboxTools"),
      agentErrorMessage("sandbox.unavailable.detail.windowsVirtualization"),
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
