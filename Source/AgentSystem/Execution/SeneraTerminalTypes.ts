import type { SeneraProcessExecutionProfile } from "./SeneraExecutionProfile.js";
import type { SeneraShellCommandSpec, SeneraShellDialect } from "./SeneraShellCommand.js";

export const SeneraTerminalCapabilityNames = {
  Persistent: "persistent",
  InteractiveInput: "interactive-input",
  Resize: "resize",
  Signals: "signals",
  SeparateStderr: "separate-stderr",
  ProcessTreeControl: "process-tree-control",
} as const;

export type SeneraTerminalCapability =
  (typeof SeneraTerminalCapabilityNames)[keyof typeof SeneraTerminalCapabilityNames];

export const SeneraTerminalCapabilityProviders = {
  HostPty: "host-pty",
  GuestNodePty: "guest-node-pty",
  MicrosandboxSdk: "microsandbox-sdk",
} as const;

export type SeneraTerminalCapabilityProvider =
  (typeof SeneraTerminalCapabilityProviders)[keyof typeof SeneraTerminalCapabilityProviders];

export const SeneraTerminalPersistenceScopes = {
  ExecutionResource: "execution-resource",
  Process: "process",
} as const;

export type SeneraTerminalPersistenceScope =
  (typeof SeneraTerminalPersistenceScopes)[keyof typeof SeneraTerminalPersistenceScopes];

export type SeneraTerminalBoundary = "local" | "sandbox";

export type SeneraTerminalSignal = "interrupt" | "terminate" | "kill";

export interface SeneraTerminalBackendDescriptor {
  readonly id: string;
  readonly boundary: SeneraTerminalBoundary;
  readonly shellDialect: SeneraShellDialect;
  readonly capabilities: ReadonlySet<SeneraTerminalCapability>;
  readonly capabilityProviders?: Partial<Record<SeneraTerminalCapability, SeneraTerminalCapabilityProvider>>;
  readonly persistenceScope?: SeneraTerminalPersistenceScope;
}

export interface SeneraTerminalFallbackMetadata {
  readonly reason: "sandbox_unavailable" | "terminal_capability_unsupported" | "shell_dialect_unsupported";
  readonly rule: string;
  readonly approvalId?: string;
  readonly scope?: "once" | "session";
}

export interface SeneraTerminalExecutionMetadata {
  readonly requestedBoundary: SeneraTerminalBoundary;
  readonly effectiveBoundary: SeneraTerminalBoundary;
  readonly backendId: string;
  readonly shellDialect: SeneraShellDialect;
  readonly capabilities: readonly SeneraTerminalCapability[];
  readonly capabilityProviders?: Partial<Record<SeneraTerminalCapability, SeneraTerminalCapabilityProvider>>;
  readonly persistenceScope?: SeneraTerminalPersistenceScope;
  readonly sandboxId?: string;
  readonly fallback?: SeneraTerminalFallbackMetadata;
}

export const SeneraTerminalDefaults = {
  columns: 120,
  rows: 30,
  name: "xterm-256color",
} as const;

export const SeneraTerminalDimensionLimits = {
  minColumns: 20,
  maxColumns: 500,
  minRows: 5,
  maxRows: 200,
} as const;

export interface SeneraTerminalDimensions {
  columns: number;
  rows: number;
}

export function normalizeSeneraTerminalDimensions(
  dimensions: Partial<SeneraTerminalDimensions> = {},
): SeneraTerminalDimensions {
  const normalized = {
    columns: dimensions.columns ?? SeneraTerminalDefaults.columns,
    rows: dimensions.rows ?? SeneraTerminalDefaults.rows,
  };
  const limits = SeneraTerminalDimensionLimits;
  if (
    !Number.isInteger(normalized.columns) ||
    normalized.columns < limits.minColumns ||
    normalized.columns > limits.maxColumns ||
    !Number.isInteger(normalized.rows) ||
    normalized.rows < limits.minRows ||
    normalized.rows > limits.maxRows
  ) {
    throw new RangeError(
      `Terminal dimensions must be ${limits.minColumns}-${limits.maxColumns} columns and ${limits.minRows}-${limits.maxRows} rows.`,
    );
  }
  return normalized;
}

export interface SeneraTerminalSpawnOptions extends SeneraTerminalDimensions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  name?: string;
  signal?: AbortSignal;
  profile?: SeneraProcessExecutionProfile;
  maxDurationMs?: number;
  requiredCapabilities?: readonly SeneraTerminalCapability[];
  shellCommand?: SeneraShellCommandSpec;
}

export interface SeneraTerminalDisposable {
  dispose(): void;
}

export interface SeneraTerminalExitEvent {
  exitCode: number;
  signal?: NodeJS.Signals | number;
}

export interface SeneraTerminalChild {
  readonly metadata: SeneraTerminalExecutionMetadata;
  readonly pid?: number;
  write(data: string | Buffer): Promise<void>;
  resize?(columns: number, rows: number): Promise<void>;
  signal(signal: SeneraTerminalSignal): Promise<void>;
  onData(listener: (data: string | Buffer) => void): SeneraTerminalDisposable;
  onError(listener: (error: Error) => void): SeneraTerminalDisposable;
  onExit(listener: (event: SeneraTerminalExitEvent) => void): SeneraTerminalDisposable;
}

export interface SeneraTerminalBackend {
  readonly descriptor: SeneraTerminalBackendDescriptor;
  resolveShellInvocation(command: string): { command: string; args: string[] };
  spawn(command: string, args: readonly string[], options: SeneraTerminalSpawnOptions): Promise<SeneraTerminalChild>;
}

export type SeneraTerminalSpawner = (
  command: string,
  args: readonly string[],
  options: SeneraTerminalSpawnOptions,
) => Promise<SeneraTerminalChild>;
