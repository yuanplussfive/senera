import type { AgentSandboxPreparationProgress } from "../Sandbox/AgentSandboxRuntimeTypes.js";
import type { AgentGvisorExecutionRequest } from "../Sandbox/Gvisor/AgentGvisorWorkerProtocol.js";
import type { SeneraTerminalSignal } from "./SeneraTerminalTypes.js";

export type SeneraGvisorProcessEvent =
  | { kind: "output"; stream: "stdout" | "stderr"; data: Buffer }
  | { kind: "exit"; code: number | null; signal: NodeJS.Signals | null };

export interface SeneraGvisorProcessHandle {
  readonly id: string;
  readonly events: AsyncIterable<SeneraGvisorProcessEvent>;
  write(data: Uint8Array): Promise<void>;
  endInput(): Promise<void>;
  terminate(signal: SeneraTerminalSignal): Promise<void>;
}

export interface SeneraGvisorRuntimeProbe {
  runtimeName?: string;
  contractId: string;
  image: string;
  imageReady: boolean;
  isolation: "gvisor" | "docker-engine";
}

export interface SeneraGvisorWorkerClient {
  probe(input: { timeoutMs: number }): Promise<SeneraGvisorRuntimeProbe>;
  prepare(input: {
    timeoutMs: number;
    onProgress?: (progress: AgentSandboxPreparationProgress) => void;
  }): Promise<void>;
  start(request: AgentGvisorExecutionRequest): Promise<SeneraGvisorProcessHandle>;
}
