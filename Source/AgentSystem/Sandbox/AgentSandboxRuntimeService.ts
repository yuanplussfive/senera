import {
  AgentSandboxRuntimeProvider,
  type AgentSandboxRuntimeState,
  type AgentSandboxRuntimeSnapshot,
} from "./AgentSandboxRuntimeTypes.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";
import { resolveSandboxRuntimeConfig } from "../AgentDefaults.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import { resolveAgentSandboxRuntimePaths } from "./AgentSandboxRuntimePreparation.js";

export interface AgentSandboxRuntimePreparationStatus {
  state: AgentSandboxRuntimeState;
  message?: string;
  error?: string;
  updatedAt?: string;
}

export interface AgentSandboxRuntimeServiceOptions {
  workspaceRoot?: string;
  configSnapshot?: () => AgentSystemConfig;
  platform?: NodeJS.Platform;
  clock?: () => Date;
  packageAvailable?: () => boolean;
}

export class AgentSandboxRuntimeService {
  private readonly workspaceRoot: string;
  private readonly configSnapshot: (() => AgentSystemConfig) | undefined;
  private readonly platform: NodeJS.Platform;
  private readonly clock: () => Date;
  private readonly packageAvailable: () => boolean;
  private preparationStatus: AgentSandboxRuntimePreparationStatus = {
    state: "unknown",
  };

  constructor(options: AgentSandboxRuntimeServiceOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.configSnapshot = options.configSnapshot;
    this.platform = options.platform ?? process.platform;
    this.clock = options.clock ?? (() => new Date());
    this.packageAvailable = options.packageAvailable ?? resolveMicrosandboxPackageAvailable;
  }

  snapshot(): AgentSandboxRuntimeSnapshot {
    const supported = this.packageAvailable();
    const paths = this.runtimePaths();
    const state = supported ? this.preparationStatus.state : "unavailable";
    const effectiveMode = supported && state === "ready" ? "sandbox" : "unavailable";
    const diagnostics = this.diagnostics(supported, state);
    return {
      provider: AgentSandboxRuntimeProvider,
      platform: this.platform,
      state,
      supported,
      effectiveMode,
      paths,
      dependencies: {
        errors: this.dependencyErrors(supported, state),
        warnings: this.dependencyWarnings(supported, state),
      },
      diagnostics,
      message: this.message(supported, state),
      updatedAt: this.clock().toISOString(),
    };
  }

  markPreparing(message = agentErrorMessage("sandbox.preparing.statusMessage")): void {
    this.preparationStatus = {
      state: "preparing",
      message,
      updatedAt: this.clock().toISOString(),
    };
  }

  markReady(message = agentErrorMessage("sandbox.ready.statusMessage")): void {
    this.preparationStatus = {
      state: "ready",
      message,
      updatedAt: this.clock().toISOString(),
    };
  }

  markUnavailable(error: unknown, message = agentErrorMessage("sandbox.unavailable.statusMessage")): void {
    this.preparationStatus = {
      state: "unavailable",
      message,
      error: errorMessage(error),
      updatedAt: this.clock().toISOString(),
    };
  }

  private runtimePaths(): AgentSandboxRuntimeSnapshot["paths"] {
    const config = this.configSnapshot?.();
    if (!config) {
      return undefined;
    }

    return resolveAgentSandboxRuntimePaths(this.workspaceRoot, resolveSandboxRuntimeConfig(config));
  }

  private dependencyErrors(supported: boolean, state: AgentSandboxRuntimeState): string[] {
    if (!supported) {
      return ["microsandbox package is not resolvable"];
    }
    if (state === "unavailable" && this.preparationStatus.error) {
      return [this.preparationStatus.error];
    }
    return [];
  }

  private dependencyWarnings(supported: boolean, state: AgentSandboxRuntimeState): string[] {
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

  private diagnostics(supported: boolean, state: AgentSandboxRuntimeState): AgentSandboxRuntimeSnapshot["diagnostics"] {
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
      return [microsandboxUnavailableDiagnostic(this.preparationStatus.error)];
    }
    return [microsandboxConfiguredDiagnostic()];
  }

  private message(supported: boolean, state: AgentSandboxRuntimeState): string {
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
