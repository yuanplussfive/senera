import {
  AgentGvisorWorkerMaxFrameBytes,
  type AgentGvisorWorkerClientMessage,
  type AgentGvisorWorkerServerMessage,
} from "./AgentGvisorWorkerProtocol.js";

export type AgentGvisorWorkerMessage = AgentGvisorWorkerClientMessage | AgentGvisorWorkerServerMessage;

export function encodeAgentGvisorWorkerFrame(message: AgentGvisorWorkerMessage): Buffer {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  if (payload.byteLength > AgentGvisorWorkerMaxFrameBytes) {
    throw new Error(`gVisor worker frame exceeds ${AgentGvisorWorkerMaxFrameBytes} bytes.`);
  }
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(payload.byteLength);
  return Buffer.concat([header, payload]);
}

export class AgentGvisorWorkerFrameDecoder {
  private buffered = Buffer.alloc(0);

  push(chunk: Uint8Array): unknown[] {
    this.buffered = Buffer.concat([this.buffered, Buffer.from(chunk)]);
    const frames: unknown[] = [];
    while (this.buffered.byteLength >= 4) {
      const length = this.buffered.readUInt32BE(0);
      if (length <= 0 || length > AgentGvisorWorkerMaxFrameBytes) {
        throw new Error(`Invalid gVisor worker frame length: ${length}.`);
      }
      if (this.buffered.byteLength < length + 4) break;
      const payload = this.buffered.subarray(4, length + 4);
      this.buffered = this.buffered.subarray(length + 4);
      frames.push(JSON.parse(payload.toString("utf8")) as unknown);
    }
    return frames;
  }
}
