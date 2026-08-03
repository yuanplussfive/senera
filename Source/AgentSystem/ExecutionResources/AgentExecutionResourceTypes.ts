import type { AgentEventSink } from "../Events/AgentEvent.js";
import type {
  SeneraTerminalBoundary,
  SeneraTerminalCapability,
  SeneraTerminalCapabilityProvider,
  SeneraTerminalPersistenceScope,
} from "../Execution/SeneraTerminalTypes.js";
import type { SeneraShellDialect } from "../Execution/SeneraShellCommand.js";

export const AgentExecutionResourceStates = {
  Starting: "starting",
  Running: "running",
  Completed: "completed",
  Failed: "failed",
  Cancelled: "cancelled",
} as const;

export type AgentExecutionResourceState =
  (typeof AgentExecutionResourceStates)[keyof typeof AgentExecutionResourceStates];

export const AgentExecutionResourceSignals = {
  Interrupt: "interrupt",
  Terminate: "terminate",
  Kill: "kill",
} as const;

export type AgentExecutionResourceSignal =
  (typeof AgentExecutionResourceSignals)[keyof typeof AgentExecutionResourceSignals];

export type AgentExecutionResourceKind = "process" | "terminal";

export interface AgentExecutionResourceTerminalMetadata {
  backend: string;
  shellDialect: SeneraShellDialect;
  requestedBoundary: SeneraTerminalBoundary;
  effectiveBoundary: SeneraTerminalBoundary;
  capabilities: readonly SeneraTerminalCapability[];
  capabilityProviders?: Partial<Record<SeneraTerminalCapability, SeneraTerminalCapabilityProvider>>;
  persistenceScope?: SeneraTerminalPersistenceScope;
  sandboxId?: string;
  columns: number;
  rows: number;
}

export interface AgentExecutionResourceOwner {
  workspaceRoot: string;
  sessionId?: string;
  requestId?: string;
}

export interface AgentExecutionResourceCorrelation {
  requestId?: string;
  sessionId?: string;
  step?: number;
  toolCallId?: string;
  toolName?: string;
  onEvent?: AgentEventSink;
}

export type AgentExecutionResourceEvent =
  | {
      cursor: number;
      timestamp: string;
      kind: "output";
      stream: "stdout" | "stderr";
      text: string;
      byteLength: number;
      totalBytes: number;
      truncated?: boolean;
    }
  | {
      cursor: number;
      timestamp: string;
      kind: "state";
      state: AgentExecutionResourceState;
      reason?: string;
    };

export interface AgentExecutionResourceSnapshot {
  resourceId: string;
  kind: AgentExecutionResourceKind;
  state: AgentExecutionResourceState;
  command: string;
  cwd: string;
  pid?: number;
  createdAt: string;
  updatedAt: string;
  cursor: number;
  oldestCursor: number;
  truncated: boolean;
  events: AgentExecutionResourceEvent[];
  exitCode?: number | null;
  signal?: NodeJS.Signals | number | null;
  terminal?: AgentExecutionResourceTerminalMetadata;
  error?: string;
}

export interface AgentExecutionResourceLimits {
  maxActive: number;
  maxBufferedBytes: number;
  maxInputBytes: number;
  maxWaitMs: number;
  idleTtlMs: number;
  terminalTtlMs: number;
  sweepIntervalMs: number;
  terminationGraceMs: number;
}

export interface AgentExecutionResourceHandle {
  readonly id: string;
  readonly owner: AgentExecutionResourceOwner;
  readonly state: AgentExecutionResourceState;
  readonly terminal: boolean;
  readonly closed: boolean;
  readonly lastAccessedAt: number;
  inspect(cursor?: number): AgentExecutionResourceSnapshot;
  wait(cursor: number, timeoutMs: number, signal?: AbortSignal): Promise<AgentExecutionResourceSnapshot>;
  write(input: Uint8Array): Promise<AgentExecutionResourceSnapshot>;
  resize(columns: number, rows: number): Promise<AgentExecutionResourceSnapshot>;
  signal(signal: AgentExecutionResourceSignal): Promise<AgentExecutionResourceSnapshot>;
  close(): Promise<void>;
}
