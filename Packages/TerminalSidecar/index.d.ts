import type { z } from "zod";

export declare const SeneraTerminalSidecarProtocolVersion: 1;
export declare const SeneraTerminalSidecarMaxFrameBytes: number;

export declare const TerminalSidecarClientMessageSchema: z.ZodType<TerminalSidecarClientMessage>;
export declare const TerminalSidecarServerMessageSchema: z.ZodType<TerminalSidecarServerMessage>;

export type TerminalSidecarSignal = "interrupt" | "terminate" | "kill";

export type TerminalSidecarClientMessage =
  | {
      type: "open";
      protocolVersion: 1;
      command: string;
      args: string[];
      cwd: string;
      env: Record<string, string>;
      columns: number;
      rows: number;
      terminalName: string;
    }
  | { type: "write"; requestId: number; input: string }
  | { type: "resize"; requestId: number; columns: number; rows: number }
  | { type: "signal"; requestId: number; signal: TerminalSidecarSignal }
  | { type: "close"; requestId: number };

export type TerminalSidecarServerMessage =
  | { type: "ready"; protocolVersion: 1; pid: number }
  | { type: "output"; sequence: number; data: string }
  | { type: "ack"; requestId: number; operation: "write" | "resize" | "signal" | "close" }
  | { type: "exit"; exitCode: number; signal?: number }
  | { type: "error"; code: string; message: string; fatal: boolean; requestId?: number };

export declare function encodeTerminalSidecarClientMessage(message: TerminalSidecarClientMessage): Buffer;
export declare function encodeTerminalSidecarServerMessage(message: TerminalSidecarServerMessage): Buffer;

export declare class TerminalSidecarClientFrameDecoder {
  push(chunk: Uint8Array): TerminalSidecarClientMessage[];
}

export declare class TerminalSidecarServerFrameDecoder {
  push(chunk: Uint8Array): TerminalSidecarServerMessage[];
}
