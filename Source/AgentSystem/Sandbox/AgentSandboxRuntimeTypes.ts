export const AgentSandboxRuntimeProvider = "microsandbox";

export type AgentSandboxEffectiveMode = "sandbox" | "fallback";
export type AgentSandboxDiagnosticSeverity = "warning" | "error";

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
  bundleDir: string;
  msbPath: string;
  libkrunfwPath: string;
}

export interface AgentSandboxRuntimeSnapshot {
  provider: typeof AgentSandboxRuntimeProvider;
  platform: NodeJS.Platform;
  supported: boolean;
  effectiveMode: AgentSandboxEffectiveMode;
  paths?: AgentSandboxRuntimePathSnapshot;
  dependencies: AgentSandboxDependencySnapshot;
  diagnostics: AgentSandboxDiagnostic[];
  message: string;
  updatedAt: string;
}
