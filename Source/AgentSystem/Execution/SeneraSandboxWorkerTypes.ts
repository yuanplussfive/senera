import type { AgentSandboxPreparationProgress } from "../Sandbox/AgentSandboxRuntimeTypes.js";
import type { AgentSandboxExecutionRequest } from "../Sandbox/Worker/AgentSandboxWorkerProtocol.js";
import type { SeneraTerminalSignal } from "./SeneraTerminalTypes.js";

export type SeneraSandboxProcessEvent =
  | { kind: "output"; stream: "stdout" | "stderr"; data: Buffer }
  | { kind: "exit"; code: number | null; signal: NodeJS.Signals | null };

export interface SeneraSandboxProcessHandle {
  readonly id: string;
  readonly events: AsyncIterable<SeneraSandboxProcessEvent>;
  write(data: Uint8Array): Promise<void>;
  endInput(): Promise<void>;
  terminate(signal: SeneraTerminalSignal): Promise<void>;
}

export interface SeneraSandboxRuntimeProbe {
  runtimeName?: string;
  contractId: string;
  image: string;
  imageReady: boolean;
  isolation: "gvisor" | "docker-engine";
}

export interface SeneraSandboxWorkerClient {
  probe(input: { timeoutMs: number }): Promise<SeneraSandboxRuntimeProbe>;
  prepare(input: {
    timeoutMs: number;
    onProgress?: (progress: AgentSandboxPreparationProgress) => void;
  }): Promise<void>;
  start(request: AgentSandboxExecutionRequest): Promise<SeneraSandboxProcessHandle>;
}
