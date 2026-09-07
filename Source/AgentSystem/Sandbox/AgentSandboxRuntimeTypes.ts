export const AgentSandboxRuntimeProviders = {
  Gvisor: "gvisor",
  DockerEngine: "docker-engine",
} as const;

export type AgentSandboxRuntimeProvider =
  (typeof AgentSandboxRuntimeProviders)[keyof typeof AgentSandboxRuntimeProviders];

export type AgentSandboxEffectiveMode =
  import("../Execution/SeneraExecutionRuntimeCapabilities.js").SeneraExecutionEffectiveMode;
export type AgentSandboxRuntimeState = "disabled" | "unknown" | "preparing" | "ready" | "unavailable";
export type AgentSandboxDiagnosticSeverity = "warning" | "error";

export type AgentSandboxRuntimeAvailability =
  | {
      readonly kind: "available";
      readonly provider: AgentSandboxRuntimeProvider;
    }
  | {
      readonly kind: "disabled";
      readonly reason: "configuration-disabled" | "docker-engine-unavailable" | "platform-host-policy";
      readonly detail?: string;
    };

export const AgentSandboxPreparationStages = {
  DetectingEngine: "detecting_engine",
  ConnectingWorker: "connecting_worker",
  PullingImage: "pulling_image",
  VerifyingImage: "verifying_image",
  ProbingToolchain: "probing_toolchain",
} as const;

export type AgentSandboxPreparationStage =
  (typeof AgentSandboxPreparationStages)[keyof typeof AgentSandboxPreparationStages];

/**
 * A typed preparation checkpoint. Byte counters are only present when the
 * underlying runtime exposes a trustworthy total; callers must not infer a
 * percentage from missing totals.
 */
export interface AgentSandboxPreparationProgress {
  stage: AgentSandboxPreparationStage;
  item?: string;
  completed?: number;
  total?: number;
  downloadedBytes?: number;
  totalBytes?: number;
}

export interface AgentSandboxDiagnostic {
  code: string;
  severity: AgentSandboxDiagnosticSeverity;
  message: string;
  recommendation: string;
  details: string[];
  manualCommands?: string[];
}

export interface AgentSandboxDependencySnapshot {
  errors: string[];
  warnings: string[];
}

export interface AgentSandboxRuntimePathSnapshot {
  baseDir: string;
}

export interface AgentSandboxRuntimeSnapshot {
  provider?: AgentSandboxRuntimeProvider;
  platform: NodeJS.Platform;
  state: AgentSandboxRuntimeState;
  supported: boolean;
  effectiveMode: AgentSandboxEffectiveMode;
  effectiveTarget?: "Local" | "Sandbox";
  shellDialect?: import("../Execution/SeneraShellCommand.js").SeneraShellDialect;
  availableExecutionTargets: readonly ("Local" | "Sandbox")[];
  localExecution: import("../Execution/SeneraExecutionRuntimeCapabilities.js").SeneraLocalExecutionCapability;
  paths?: AgentSandboxRuntimePathSnapshot;
  progress?: AgentSandboxPreparationProgress;
  dependencies: AgentSandboxDependencySnapshot;
  diagnostics: AgentSandboxDiagnostic[];
  message: string;
  updatedAt: string;
}
