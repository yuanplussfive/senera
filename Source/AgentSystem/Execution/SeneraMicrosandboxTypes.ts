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

export interface SeneraMicrosandboxSession {
  exec(request: SeneraMicrosandboxExecRequest): AsyncIterable<SeneraMicrosandboxExecEvent>;
  stop(timeoutMs: number): Promise<void>;
  kill(): Promise<void>;
}

export interface SeneraMicrosandboxSdkAdapter {
  isInstalled(): Promise<boolean>;
  createSandbox(request: SeneraMicrosandboxCreateRequest): Promise<SeneraMicrosandboxSession>;
}
