export type SandboxEffectiveMode = "host" | "sandbox" | "unavailable";
export type SandboxRuntimeState = "disabled" | "unknown" | "preparing" | "ready" | "unavailable";
export type SandboxPreparationStage =
  "detecting_engine" | "connecting_worker" | "pulling_image" | "verifying_image" | "probing_toolchain";

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
  provider?: "gvisor" | "docker-engine";
  platform: string;
  state: SandboxRuntimeState;
  supported: boolean;
  effectiveMode: SandboxEffectiveMode;
  effectiveTarget?: "Local" | "Sandbox";
  shellDialect?: "posix-sh" | "powershell";
  availableExecutionTargets: Array<"Local" | "Sandbox">;
  localExecution: {
    mode: "windows-governed-local" | "posix-governed-local";
    isolation: "host";
    authorization: "opa";
    processOwnership: "windows-job" | "posix-process-group";
    filesystem: "host-visible";
    network: "host-visible";
  };
  progress?: SandboxPreparationProgressData;
  dependencies: SandboxDependencySnapshotData;
  diagnostics: SandboxDiagnosticData[];
  message: string;
  updatedAt: string;
}
