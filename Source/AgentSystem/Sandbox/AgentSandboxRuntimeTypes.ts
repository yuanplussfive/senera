export const AgentSandboxRuntimeProviders = {
  Microsandbox: "microsandbox",
  Gvisor: "gvisor",
  DockerEngine: "docker-engine",
} as const;

export type AgentSandboxRuntimeProvider =
  (typeof AgentSandboxRuntimeProviders)[keyof typeof AgentSandboxRuntimeProviders];

export type AgentSandboxEffectiveMode = "sandbox" | "unavailable" | "disabled";
export type AgentSandboxRuntimeState = "disabled" | "unknown" | "preparing" | "ready" | "unavailable";
export type AgentSandboxDiagnosticSeverity = "warning" | "error";

export const AgentSandboxPreparationStages = {
  CheckingHostRuntime: "checking_host_runtime",
  ConnectingWorker: "connecting_worker",
  LoadingRuntime: "loading_runtime",
  ResolvingArchive: "resolving_archive",
  VerifyingArchive: "verifying_archive",
  ImportingImage: "importing_image",
  WarmingImage: "warming_image",
  ProbingSandbox: "probing_sandbox",
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
  provider: AgentSandboxRuntimeProvider;
  platform: NodeJS.Platform;
  state: AgentSandboxRuntimeState;
  supported: boolean;
  effectiveMode: AgentSandboxEffectiveMode;
  paths?: AgentSandboxRuntimePathSnapshot;
  progress?: AgentSandboxPreparationProgress;
  dependencies: AgentSandboxDependencySnapshot;
  diagnostics: AgentSandboxDiagnostic[];
  message: string;
  updatedAt: string;
}
