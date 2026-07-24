export type SandboxEffectiveMode = "sandbox" | "unavailable" | "disabled";
export type SandboxRuntimeState = "disabled" | "unknown" | "preparing" | "ready" | "unavailable";
export type SandboxPreparationStage =
  | "checking_host_runtime"
  | "loading_runtime"
  | "resolving_archive"
  | "downloading_archive"
  | "verifying_archive"
  | "importing_image"
  | "warming_image";

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
