import type { AgentToolProcessResponse } from "../Types/ToolRuntimeTypes.js";
import type { SeneraExecutionLimits } from "../Execution/SeneraExecutionTypes.js";
import type { SeneraProcessExecutionProfile } from "../Execution/SeneraExecutionProfile.js";

export interface AgentToolProcessSpawnOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  stdio: ["pipe", "pipe", "pipe"];
  windowsHide: boolean;
  timeoutMs: number;
  limits: SeneraExecutionLimits;
  signal?: AbortSignal;
  profile?: SeneraProcessExecutionProfile;
}

export interface AgentToolProcessChild {
  stdin: {
    end(chunk?: string): void;
  };
  stdout: {
    on(event: "data", listener: (chunk: Buffer) => void): void;
  };
  stderr: {
    on(event: "data", listener: (chunk: Buffer) => void): void;
  };
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "close", listener: (exitCode: number | null, signal: NodeJS.Signals | null) => void): void;
  kill(signal?: NodeJS.Signals): boolean;
  pid?: number;
}

export type AgentToolProcessSpawner = (
  command: string,
  args: string[],
  options: AgentToolProcessSpawnOptions,
) => AgentToolProcessChild;

export interface AgentToolProcessRunResult {
  response: AgentToolProcessResponse;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export interface AgentToolProcessResponseParseContext {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  modulePath: string;
}
