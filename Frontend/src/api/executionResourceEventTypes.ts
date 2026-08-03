export interface ExecutionResourceOutputData {
  resourceId: string;
  toolCallId?: string;
  toolName?: string;
  cursorStart?: number;
  cursor: number;
  stream: "stdout" | "stderr";
  text: string;
  byteLength: number;
  totalBytes: number;
  truncated?: boolean;
}

export interface ExecutionResourceCreatedData {
  resource: ExecutionResourceSnapshotData;
}

export interface ExecutionResourceResizedData {
  resourceId: string;
  columns: number;
  rows: number;
}

export interface ExecutionResourceRemovedData {
  resourceId: string;
  reason: "released" | "expired" | "stop_all" | "broker_closed";
}

export interface ExecutionResourceStateData {
  resourceId: string;
  toolCallId?: string;
  toolName?: string;
  cursor: number;
  state: "starting" | "running" | "completed" | "failed" | "cancelled";
  pid?: number;
  exitCode?: number | null;
  signal?: string | null;
  reason?: string;
}

export type ExecutionResourceState = ExecutionResourceStateData["state"];

export type ExecutionResourceTerminalCapability =
  "persistent" | "interactive-input" | "resize" | "signals" | "separate-stderr" | "process-tree-control";

export type ExecutionResourceTerminalCapabilityProvider = "host-pty" | "guest-node-pty" | "microsandbox-sdk";
export type ExecutionResourceTerminalPersistenceScope = "execution-resource" | "process";

export interface ExecutionResourceTerminalData {
  backend: string;
  shellDialect: "posix-sh" | "powershell";
  requestedBoundary: "local" | "sandbox";
  effectiveBoundary: "local" | "sandbox";
  capabilities: ExecutionResourceTerminalCapability[];
  capabilityProviders?: Partial<
    Record<ExecutionResourceTerminalCapability, ExecutionResourceTerminalCapabilityProvider>
  >;
  persistenceScope?: ExecutionResourceTerminalPersistenceScope;
  sandboxId?: string;
  columns: number;
  rows: number;
}

export interface ExecutionResourceEventData {
  cursor: number;
  timestamp: string;
  kind: "output" | "state";
  stream?: "stdout" | "stderr";
  text?: string;
  byteLength?: number;
  totalBytes?: number;
  truncated?: boolean;
  state?: ExecutionResourceState;
  reason?: string;
}

export interface ExecutionResourceSnapshotData {
  resourceId: string;
  kind: "process" | "terminal";
  state: ExecutionResourceState;
  command: string;
  cwd: string;
  pid?: number;
  createdAt: string;
  updatedAt: string;
  cursor: number;
  oldestCursor: number;
  truncated: boolean;
  events: ExecutionResourceEventData[];
  exitCode?: number | null;
  signal?: string | number | null;
  error?: string;
  terminal?: ExecutionResourceTerminalData;
}

export interface ExecutionResourceSnapshotEventData {
  operation: "list" | "inspect" | "write" | "resize" | "signal" | "stop_all";
  resources: ExecutionResourceSnapshotData[];
}
