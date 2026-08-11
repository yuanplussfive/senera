import {
  AgentSandboxWorkerMaxFrameBytes,
  type AgentSandboxWorkerClientMessage,
  type AgentSandboxWorkerServerMessage,
} from "./AgentSandboxWorkerProtocol.js";
import { parseJsonText } from "../../Core/AgentJsonParsing.js";

export type AgentSandboxWorkerMessage = AgentSandboxWorkerClientMessage | AgentSandboxWorkerServerMessage;

export function encodeAgentSandboxWorkerFrame(message: AgentSandboxWorkerMessage): Buffer {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  if (payload.byteLength > AgentSandboxWorkerMaxFrameBytes) {
    throw new Error(`Sandbox worker frame exceeds ${AgentSandboxWorkerMaxFrameBytes} bytes.`);
  }
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(payload.byteLength);
  return Buffer.concat([header, payload]);
}

export class AgentSandboxWorkerFrameDecoder {
  private buffered = Buffer.alloc(0);

  push(chunk: Uint8Array): unknown[] {
    this.buffered = Buffer.concat([this.buffered, Buffer.from(chunk)]);
    const frames: unknown[] = [];
    while (this.buffered.byteLength >= 4) {
      const length = this.buffered.readUInt32BE(0);
      if (length <= 0 || length > AgentSandboxWorkerMaxFrameBytes) {
        throw new Error(`Invalid sandbox worker frame length: ${length}.`);
      }
      if (this.buffered.byteLength < length + 4) break;
      const payload = this.buffered.subarray(4, length + 4);
      this.buffered = this.buffered.subarray(length + 4);
      frames.push(parseJsonText(payload.toString("utf8"), "sandbox worker frame") as unknown);
    }
    return frames;
  }
}
