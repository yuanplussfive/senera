import type { SeneraProcessExecutionProfile } from "./SeneraExecutionProfile.js";

export interface SeneraPersistentProcessSpawnOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  windowsHide: boolean;
  signal?: AbortSignal;
  profile?: SeneraProcessExecutionProfile;
}

export interface SeneraPersistentProcessChild {
  stdin: {
    write(chunk: string | Buffer): boolean;
    once(event: "drain", listener: () => void): void;
    on?(event: "error", listener: (error: Error) => void): void;
    off?(event: "drain", listener: () => void): void;
    off?(event: "error", listener: (error: Error) => void): void;
    end(): void;
  };
  stdout: {
    on(event: "data", listener: (chunk: Buffer) => void): void;
    on(event: "error", listener: (error: Error) => void): void;
  };
  stderr?: {
    on(event: "data", listener: (chunk: Buffer) => void): void;
  } | null;
  on(event: "error", listener: (error: Error) => void): void;
  once(event: "close", listener: () => void): void;
  on(event: "close", listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void): void;
  off?(event: "close", listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void): void;
  kill(signal?: NodeJS.Signals): boolean;
  pid?: number;
  exitCode?: number | null;
  signalCode?: NodeJS.Signals | null;
}

export type SeneraPersistentProcessSpawner = (
  command: string,
  args: readonly string[],
  options: SeneraPersistentProcessSpawnOptions,
) => Promise<SeneraPersistentProcessChild>;
