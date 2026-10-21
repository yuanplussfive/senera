import type { AgentSandboxRuntimeProvider } from "../Sandbox/AgentSandboxRuntimeTypes.js";
import { SeneraShellDialects, type SeneraShellDialect } from "./SeneraShellCommand.js";

export const SeneraLocalExecutionModes = {
  WindowsGovernedLocal: "windows-governed-local",
  PosixGovernedLocal: "posix-governed-local",
} as const;

export type SeneraLocalExecutionMode = (typeof SeneraLocalExecutionModes)[keyof typeof SeneraLocalExecutionModes];
export type SeneraProcessBackendCapability = "local" | "sandbox";
export type SeneraExecutionEffectiveMode = "host" | "sandbox" | "unavailable";

export interface SeneraLocalExecutionCapability {
  readonly mode: SeneraLocalExecutionMode;
  readonly isolation: "host";
  readonly authorization: "opa";
  readonly processOwnership: "windows-job" | "posix-process-group";
  readonly filesystem: "host-visible";
  readonly network: "host-visible";
}

export interface SeneraExecutionRuntimeCapabilities {
  readonly local: SeneraLocalExecutionCapability;
  readonly sandbox?: {
    readonly provider: AgentSandboxRuntimeProvider;
    readonly isolation: "container";
  };
  readonly effectiveMode: SeneraExecutionEffectiveMode;
  readonly effectiveBackend?: SeneraProcessBackendCapability;
  readonly shellDialect?: SeneraShellDialect;
  readonly processBackends: readonly SeneraProcessBackendCapability[];
  readonly persistentProcessBackends: readonly SeneraProcessBackendCapability[];
  readonly terminalBackends: readonly SeneraProcessBackendCapability[];
}

export function createSeneraExecutionRuntimeCapabilities(
  input: {
    readonly platform?: NodeJS.Platform;
    readonly sandboxEnabled?: boolean;
    readonly sandboxProvider?: AgentSandboxRuntimeProvider;
    readonly sandboxReady?: boolean;
    readonly sandboxPersistentProcessReady?: boolean;
    readonly sandboxTerminalReady?: boolean;
  } = {},
): SeneraExecutionRuntimeCapabilities {
  const platform = input.platform ?? process.platform;
  const sandboxSelected = input.sandboxEnabled === true;
  const sandboxReady = sandboxSelected && input.sandboxReady === true && input.sandboxProvider !== undefined;
  const effectiveMode: SeneraExecutionEffectiveMode = sandboxSelected
    ? sandboxReady
      ? "sandbox"
      : "unavailable"
    : "host";
  const effectiveBackend = effectiveMode === "host" ? "local" : effectiveMode === "sandbox" ? "sandbox" : undefined;
  const processBackends: SeneraProcessBackendCapability[] = effectiveBackend ? [effectiveBackend] : [];
  const persistentProcessBackends: SeneraProcessBackendCapability[] =
    effectiveBackend === "sandbox" && input.sandboxPersistentProcessReady === false ? [] : [...processBackends];
  const terminalBackends: SeneraProcessBackendCapability[] =
    effectiveBackend === "sandbox" && input.sandboxTerminalReady === false ? [] : [...processBackends];
  return {
    local: {
      mode:
        platform === "win32"
          ? SeneraLocalExecutionModes.WindowsGovernedLocal
          : SeneraLocalExecutionModes.PosixGovernedLocal,
      isolation: "host",
      authorization: "opa",
      processOwnership: platform === "win32" ? "windows-job" : "posix-process-group",
      filesystem: "host-visible",
      network: "host-visible",
    },
    ...(sandboxReady ? { sandbox: { provider: input.sandboxProvider!, isolation: "container" as const } } : {}),
    effectiveMode,
    ...(effectiveBackend ? { effectiveBackend } : {}),
    ...(effectiveBackend
      ? {
          shellDialect:
            effectiveBackend === "sandbox" || platform !== "win32"
              ? SeneraShellDialects.Posix
              : SeneraShellDialects.PowerShell,
        }
      : {}),
    processBackends,
    persistentProcessBackends,
    terminalBackends,
  };
}
