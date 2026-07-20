import type { SeneraMicrosandboxNetworkMode, SeneraMicrosandboxPullPolicy } from "./SeneraMicrosandboxDefaults.js";

export interface SeneraMicrosandboxCreateRequest {
  name: string;
  image: string;
  workspaceRoot: string;
  guestWorkspaceRoot: string;
  workspaceMount: "readonly" | "writable";
  writableMounts: readonly {
    hostPath: string;
    guestPath: string;
    quotaMiB?: number;
  }[];
  guestWorkdir: string;
  rootfsCopies: readonly {
    hostPath: string;
    guestPath: string;
  }[];
  env: Record<string, string>;
  cpus: number;
  memoryMiB: number;
  network: SeneraMicrosandboxNetworkMode;
  pullPolicy: SeneraMicrosandboxPullPolicy;
  runtime?: {
    baseDir: string;
    msbPath: string;
    libkrunfwPath: string;
  };
  maxDurationSeconds: number;
}

export interface SeneraMicrosandboxExecRequest {
  command: string;
  args: readonly string[];
  cwd: string;
  env: Record<string, string>;
  stdin?: string;
  timeoutMs: number;
}

export type SeneraMicrosandboxExecEvent =
  { kind: "stdout"; data: Buffer } | { kind: "stderr"; data: Buffer } | { kind: "exit"; code: number };

export interface SeneraMicrosandboxTerminalRequest {
  command: string;
  args: readonly string[];
  cwd: string;
  env: Record<string, string>;
}

export type SeneraMicrosandboxTerminalEvent =
  | { kind: "started"; pid: number }
  | { kind: "output"; stream: "stdout" | "stderr"; data: Buffer }
  | { kind: "exit"; code: number };

export interface SeneraMicrosandboxTerminalHandle {
  readonly events: AsyncIterable<SeneraMicrosandboxTerminalEvent>;
  write(data: Uint8Array | string): Promise<void>;
  signal(signal: number): Promise<void>;
  kill(): Promise<void>;
}

export interface SeneraMicrosandboxSession {
  exec(request: SeneraMicrosandboxExecRequest): AsyncIterable<SeneraMicrosandboxExecEvent>;
  openTerminal?(request: SeneraMicrosandboxTerminalRequest): Promise<SeneraMicrosandboxTerminalHandle>;
  /** Requests graceful session shutdown and rejects if the adapter cannot confirm it in time. */
  stop(timeoutMs: number): Promise<void>;
  /** Force-terminates a session after graceful shutdown fails or is unconfirmed. */
  kill(): Promise<void>;
}

export interface SeneraMicrosandboxSdkAdapter {
  isInstalled(): Promise<boolean>;
  createSandbox(request: SeneraMicrosandboxCreateRequest): Promise<SeneraMicrosandboxSession>;
}
