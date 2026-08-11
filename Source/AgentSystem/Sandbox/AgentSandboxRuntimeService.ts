import { errorMessage } from "../Core/AgentErrors.js";
import { resolveSandboxRuntimeConfig } from "../AgentDefaults.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import type { AgentSystemConfig, ResolvedAgentSandboxRuntimeConfig } from "../Types/AgentConfigTypes.js";
import type { SeneraSandboxWorkerClient } from "../Execution/SeneraSandboxWorkerTypes.js";
import { createSeneraExecutionRuntimeCapabilities } from "../Execution/SeneraExecutionRuntimeCapabilities.js";
import {
  resolveAgentSandboxRuntimePaths,
  type AgentSandboxRuntimePreparationResult,
} from "./AgentSandboxRuntimePreparation.js";
import {
  type AgentSandboxPreparationProgress,
  type AgentSandboxRuntimeAvailability,
  type AgentSandboxRuntimeProvider,
  type AgentSandboxRuntimeSnapshot,
  type AgentSandboxRuntimeState,
} from "./AgentSandboxRuntimeTypes.js";
import { prepareAgentDockerEngineRuntime } from "./DockerEngine/AgentDockerEngineRuntimePreparation.js";

export interface AgentSandboxRuntimePreparationStatus {
  state: AgentSandboxRuntimeState;
  message?: string;
  error?: string;
  progress?: AgentSandboxPreparationProgress;
  updatedAt?: string;
}

export interface AgentSandboxRuntimePrepareOptions {
  config?: ResolvedAgentSandboxRuntimeConfig;
  dockerEngineWorker?: SeneraSandboxWorkerClient;
}

export interface AgentSandboxRuntimeServiceOptions {
  workspaceRoot?: string;
  configSnapshot?: () => AgentSystemConfig;
  platform?: NodeJS.Platform;
  clock?: () => Date;
  progressUpdateIntervalMs?: number;
  availability?: AgentSandboxRuntimeAvailability;
  dockerEngineWorker?: SeneraSandboxWorkerClient;
}

export class AgentSandboxRuntimeService {
  private readonly workspaceRoot: string;
  private readonly configSnapshot: (() => AgentSystemConfig) | undefined;
  private readonly platform: NodeJS.Platform;
  private readonly clock: () => Date;
  private readonly progressUpdateIntervalMs: number;
  private readonly availability: AgentSandboxRuntimeAvailability;
  private readonly worker: SeneraSandboxWorkerClient | undefined;
  private readonly listeners = new Set<(snapshot: AgentSandboxRuntimeSnapshot) => void>();
  private preparationPromise: Promise<AgentSandboxRuntimePreparationResult | undefined> | undefined;
  private lastProgressPublicationAt = Number.NEGATIVE_INFINITY;
  private preparationStatus: AgentSandboxRuntimePreparationStatus;

  constructor(options: AgentSandboxRuntimeServiceOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.configSnapshot = options.configSnapshot;
    this.platform = options.platform ?? process.platform;
    this.clock = options.clock ?? (() => new Date());
    this.progressUpdateIntervalMs = options.progressUpdateIntervalMs ?? 200;
    this.availability = normalizeSandboxAvailability(
      this.platform,
      options.availability ?? defaultSandboxAvailability(this.runtimeConfig(), this.platform),
    );
    this.worker = options.dockerEngineWorker;
    this.preparationStatus =
      this.availability.kind === "disabled"
        ? { state: "disabled", message: this.disabledStatusMessage() }
        : { state: "unknown" };
  }

  snapshot(): AgentSandboxRuntimeSnapshot {
    const runtimeConfig = this.runtimeConfig();
    const configuredEnabled = runtimeConfig?.Enabled ?? true;
    const sandboxEnabled = configuredEnabled && this.platform !== "win32";
    const deploymentAvailable = sandboxEnabled && this.availability.kind === "available";
    const pathResolution = deploymentAvailable ? this.runtimePaths(runtimeConfig) : { paths: undefined };
    const state: AgentSandboxRuntimeState = !sandboxEnabled
      ? "disabled"
      : this.availability.kind === "disabled" || pathResolution.error || this.preparationStatus.state === "disabled"
        ? "unavailable"
        : this.preparationStatus.state;
    const unavailableError = pathResolution.error ?? this.preparationStatus.error;
    const provider = this.runtimeProvider();
    const capabilities = createSeneraExecutionRuntimeCapabilities({
      platform: this.platform,
      sandboxEnabled,
      sandboxProvider: provider,
      sandboxReady: state === "ready",
      sandboxPersistentProcessReady: state === "ready",
      sandboxTerminalReady: state === "ready",
    });
    const availableExecutionTargets = capabilities.processBackends.map((backend) =>
      backend === "sandbox" ? ("Sandbox" as const) : ("Local" as const),
    );
    return {
      ...(provider ? { provider } : {}),
      platform: this.platform,
      state,
      supported: deploymentAvailable,
      effectiveMode: capabilities.effectiveMode,
      ...(availableExecutionTargets[0] ? { effectiveTarget: availableExecutionTargets[0] } : {}),
      ...(capabilities.shellDialect ? { shellDialect: capabilities.shellDialect } : {}),
      availableExecutionTargets,
      localExecution: capabilities.local,
      paths: pathResolution.paths,
      progress: state === "preparing" ? this.preparationStatus.progress : undefined,
      dependencies: {
        errors: state === "unavailable" && unavailableError ? [unavailableError] : [],
        warnings: dependencyWarnings(provider, state, this.availability),
      },
      diagnostics: [sandboxDiagnostic(provider, state, unavailableError, this.availability)],
      message: this.message(state),
      updatedAt: this.clock().toISOString(),
    };
  }

  runtimeProvider(): AgentSandboxRuntimeProvider | undefined {
    return this.sandboxRequested() && this.availability.kind === "available" ? this.availability.provider : undefined;
  }

  sandboxBackendAvailable(): boolean {
    return this.sandboxRequested() && this.availability.kind === "available" && this.worker !== undefined;
  }

  dockerEngineWorkerClient(): SeneraSandboxWorkerClient | undefined {
    return this.worker;
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
    if (this.preparationPromise) return this.preparationPromise;
    const config = options.config ?? this.runtimeConfig();
    if (!config) throw new Error("Sandbox runtime preparation requires a resolved runtime configuration.");
    if (!config.Enabled || this.platform === "win32") {
      this.markDisabled();
      return undefined;
    }
    if (this.availability.kind === "disabled") {
      const error = new Error(this.availability.detail ?? "Docker Engine sandbox runtime is unavailable.");
      this.markUnavailable(error);
      throw error;
    }

    this.markPreparing();
    const preparation = this.prepareDockerEngine(config, options.dockerEngineWorker);
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

  close(): Promise<void> {
    return Promise.resolve();
  }

  subscribe(listener: (snapshot: AgentSandboxRuntimeSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  markReady(message = agentErrorMessage("sandbox.ready.statusMessage")): void {
    if (!this.sandboxRequested() || this.availability.kind === "disabled") {
      this.markDisabled();
      return;
    }
    this.preparationStatus = { state: "ready", message, updatedAt: this.clock().toISOString() };
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

  markDisabled(message = this.disabledStatusMessage()): void {
    this.preparationStatus = { state: "disabled", message, updatedAt: this.clock().toISOString() };
    this.publish();
  }

  private setPreparing(message: string, progress?: AgentSandboxPreparationProgress, throttle = false): void {
    if (this.availability.kind === "disabled") return;
    const previousProgress = this.preparationStatus.progress;
    this.preparationStatus = { state: "preparing", message, progress, updatedAt: this.clock().toISOString() };
    if (
      throttle &&
      previousProgress?.stage === progress?.stage &&
      this.clock().getTime() - this.lastProgressPublicationAt < this.progressUpdateIntervalMs
    ) {
      return;
    }
    this.publish();
  }

  private publish(): void {
    this.lastProgressPublicationAt = this.clock().getTime();
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private runtimeConfig(): ResolvedAgentSandboxRuntimeConfig | undefined {
    const config = this.configSnapshot?.();
    return config ? resolveSandboxRuntimeConfig(config) : undefined;
  }

  private async prepareDockerEngine(
    config: ResolvedAgentSandboxRuntimeConfig,
    workerOverride: SeneraSandboxWorkerClient | undefined,
  ): Promise<AgentSandboxRuntimePreparationResult> {
    const worker = workerOverride ?? this.worker;
    const provider = this.runtimeProvider();
    if (!worker || !provider) throw new Error("Docker Engine sandbox preparation requires an available Worker.");
    return prepareAgentDockerEngineRuntime({
      workspaceRoot: this.workspaceRoot,
      config,
      worker,
      expectedProvider: provider,
      onProgress: (progress) => this.reportProgress(progress),
    });
  }

  private runtimePaths(runtimeConfig = this.runtimeConfig()): {
    paths: AgentSandboxRuntimeSnapshot["paths"];
    error?: string;
  } {
    if (!runtimeConfig) return { paths: undefined };
    try {
      return { paths: resolveAgentSandboxRuntimePaths(this.workspaceRoot, runtimeConfig) };
    } catch (error) {
      return { paths: undefined, error: errorMessage(error) };
    }
  }

  private message(state: AgentSandboxRuntimeState): string {
    if (state === "disabled") return this.preparationStatus.message ?? this.disabledStatusMessage();
    if (state === "ready") return this.preparationStatus.message ?? agentErrorMessage("sandbox.ready.statusMessage");
    if (state === "preparing") {
      return this.preparationStatus.message ?? agentErrorMessage("sandbox.preparing.statusMessage");
    }
    if (state === "unavailable") {
      return this.preparationStatus.message ?? agentErrorMessage("sandbox.unavailable.snapshotMessage");
    }
    return agentErrorMessage("sandbox.configured.snapshotMessage");
  }

  private disabledStatusMessage(): string {
    if (this.availability.kind !== "disabled") return agentErrorMessage("sandbox.disabled.statusMessage");
    if (this.availability.reason === "platform-host-policy") {
      return agentErrorMessage("sandbox.hostPolicy.statusMessage");
    }
    return this.availability.reason === "docker-engine-unavailable"
      ? agentErrorMessage("sandbox.autoDisabled.statusMessage")
      : agentErrorMessage("sandbox.disabled.statusMessage");
  }

  private sandboxRequested(): boolean {
    return this.platform !== "win32" && (this.runtimeConfig()?.Enabled ?? true);
  }
}

function defaultSandboxAvailability(
  config: ResolvedAgentSandboxRuntimeConfig | undefined,
  platform: NodeJS.Platform,
): AgentSandboxRuntimeAvailability {
  return platform === "win32"
    ? { kind: "disabled", reason: "platform-host-policy" }
    : config?.Enabled === false
      ? { kind: "disabled", reason: "configuration-disabled" }
      : { kind: "disabled", reason: "docker-engine-unavailable" };
}

function normalizeSandboxAvailability(
  platform: NodeJS.Platform,
  availability: AgentSandboxRuntimeAvailability,
): AgentSandboxRuntimeAvailability {
  return platform === "win32" ? { kind: "disabled", reason: "platform-host-policy" } : availability;
}

function dependencyWarnings(
  provider: AgentSandboxRuntimeProvider | undefined,
  state: AgentSandboxRuntimeState,
  availability: AgentSandboxRuntimeAvailability,
): string[] {
  if (state === "disabled" && availability.kind === "disabled" && availability.detail) {
    return [availability.detail];
  }
  if (state === "unknown") return [`${provider ?? "Docker"} sandbox runtime has not been checked yet`];
  if (state === "preparing") return [`${provider ?? "Docker"} sandbox runtime is being prepared`];
  if (state === "unavailable") {
    return ["tools selected for the sandbox boundary cannot run until the configured sandbox runtime is available"];
  }
  return [];
}

function sandboxDiagnostic(
  provider: AgentSandboxRuntimeProvider | undefined,
  state: AgentSandboxRuntimeState,
  error: string | undefined,
  availability: AgentSandboxRuntimeAvailability,
): AgentSandboxRuntimeSnapshot["diagnostics"][number] {
  const diagnosticProvider = provider ?? "docker";
  if (state === "disabled") {
    const reason = availability.kind === "disabled" ? availability.reason : "configuration-disabled";
    if (reason === "platform-host-policy") {
      return {
        code: "host_execution_platform_policy",
        severity: "warning",
        message: agentErrorMessage("sandbox.hostPolicy.message"),
        recommendation: agentErrorMessage("sandbox.hostPolicy.recommendation"),
        details: [agentErrorMessage("sandbox.hostPolicy.detail")],
      };
    }
    const autoDisabled = reason === "docker-engine-unavailable";
    return {
      code: `${diagnosticProvider}_${autoDisabled ? "auto_disabled" : "disabled_by_runtime_configuration"}`,
      severity: "warning",
      message: agentErrorMessage(autoDisabled ? "sandbox.autoDisabled.message" : "sandbox.disabled.message"),
      recommendation: agentErrorMessage(
        autoDisabled ? "sandbox.autoDisabled.recommendation" : "sandbox.disabled.recommendation",
      ),
      details: [agentErrorMessage("sandbox.disabled.detail.localOnly")],
    };
  }
  if (state === "ready") {
    return {
      code: `${diagnosticProvider}_runtime_ready`,
      severity: "warning",
      message: agentErrorMessage("sandbox.ready.message"),
      recommendation: agentErrorMessage("sandbox.ready.recommendation"),
      details: [
        agentErrorMessage("sandbox.ready.detail.readOnlyWorkspace"),
        agentErrorMessage("sandbox.ready.detail.networkPolicy"),
      ],
    };
  }
  if (state === "preparing") {
    return {
      code: `${diagnosticProvider}_runtime_preparing`,
      severity: "warning",
      message: agentErrorMessage("sandbox.preparing.message"),
      recommendation: agentErrorMessage("sandbox.preparing.recommendation"),
      details: [agentErrorMessage("sandbox.preparing.detail.desktopStartup")],
    };
  }
  if (state === "unavailable") {
    return {
      code: `${diagnosticProvider}_runtime_unavailable`,
      severity: "error",
      message: agentErrorMessage("sandbox.unavailable.message"),
      recommendation: agentErrorMessage("sandbox.unavailable.recommendation"),
      details: [
        agentErrorMessage("sandbox.unavailable.detail.selectedSandboxTools"),
        ...(error ? [agentErrorMessage("sandbox.unavailable.detail.lastError", { error })] : []),
      ],
    };
  }
  return {
    code: `${diagnosticProvider}_backend_configured`,
    severity: "warning",
    message: agentErrorMessage("sandbox.configured.message"),
    recommendation: agentErrorMessage("sandbox.configured.recommendation"),
    details: [
      agentErrorMessage("sandbox.configured.detail.readOnlyWorkspace"),
      agentErrorMessage("sandbox.configured.detail.networkPolicy"),
    ],
  };
}
