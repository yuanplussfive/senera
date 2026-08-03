export type SandboxEffectiveMode = "sandbox" | "unavailable" | "disabled";
export type SandboxRuntimeState = "disabled" | "unknown" | "preparing" | "ready" | "unavailable";
export type SandboxPreparationStage =
  | "checking_host_runtime"
  | "connecting_worker"
  | "loading_runtime"
  | "resolving_archive"
  | "verifying_archive"
  | "importing_image"
  | "warming_image"
  | "probing_sandbox";

export interface SandboxPreparationProgressData {
  stage: SandboxPreparationStage;
  item?: string;
  completed?: number;
  total?: number;
  downloadedBytes?: number;
  totalBytes?: number;
}

export interface SandboxDiagnosticData {
  code: string;
  severity: "warning" | "error";
  message: string;
  recommendation: string;
  details: string[];
  manualCommands?: string[];
}

export interface SandboxDependencySnapshotData {
  errors: string[];
  warnings: string[];
}

export interface SandboxStatusSnapshotData {
  provider: string;
  platform: string;
  state: SandboxRuntimeState;
  supported: boolean;
  effectiveMode: SandboxEffectiveMode;
  progress?: SandboxPreparationProgressData;
  dependencies: SandboxDependencySnapshotData;
  diagnostics: SandboxDiagnosticData[];
  message: string;
  updatedAt: string;
}
