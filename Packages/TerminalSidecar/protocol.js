import { decode, encode } from "@msgpack/msgpack";
import { z } from "zod";

export const SeneraTerminalSidecarProtocolVersion = 1;
export const SeneraTerminalSidecarMaxFrameBytes = 16 * 1024 * 1024;

const RequestIdSchema = z.number().int().positive();
const TerminalDimensionsSchema = {
  columns: z.number().int().min(20).max(500),
  rows: z.number().int().min(5).max(200),
};

export const TerminalSidecarClientMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("open"),
      protocolVersion: z.literal(SeneraTerminalSidecarProtocolVersion),
      command: z.string().min(1),
      args: z.array(z.string()),
      cwd: z.string().min(1),
      env: z.record(z.string(), z.string()),
      ...TerminalDimensionsSchema,
      terminalName: z.string().min(1),
    })
    .strict(),
  z.object({ type: z.literal("write"), requestId: RequestIdSchema, input: z.string() }).strict(),
  z.object({ type: z.literal("resize"), requestId: RequestIdSchema, ...TerminalDimensionsSchema }).strict(),
  z
    .object({
      type: z.literal("signal"),
      requestId: RequestIdSchema,
      signal: z.enum(["interrupt", "terminate", "kill"]),
    })
    .strict(),
  z.object({ type: z.literal("close"), requestId: RequestIdSchema }).strict(),
]);

export const TerminalSidecarServerMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("ready"),
      protocolVersion: z.literal(SeneraTerminalSidecarProtocolVersion),
      pid: z.number().int().positive(),
    })
    .strict(),
  z.object({ type: z.literal("output"), sequence: z.number().int().positive(), data: z.string() }).strict(),
  z
    .object({
      type: z.literal("ack"),
      requestId: RequestIdSchema,
      operation: z.enum(["write", "resize", "signal", "close"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("exit"),
      exitCode: z.number().int(),
      signal: z.number().int().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("error"),
      code: z.string().min(1),
      message: z.string().min(1),
      fatal: z.boolean(),
      requestId: RequestIdSchema.optional(),
    })
    .strict(),
]);

export function encodeTerminalSidecarClientMessage(message) {
  return encodeFrame(TerminalSidecarClientMessageSchema.parse(message));
}

export function encodeTerminalSidecarServerMessage(message) {
  return encodeFrame(TerminalSidecarServerMessageSchema.parse(message));
}

class FrameDecoder {
  buffer = Buffer.alloc(0);

  constructor(schema) {
    this.schema = schema;
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    const messages = [];
    while (this.buffer.byteLength >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (length <= 0 || length > SeneraTerminalSidecarMaxFrameBytes) {
        throw new RangeError(`Invalid terminal sidecar frame length: ${length}.`);
      }
      if (this.buffer.byteLength < length + 4) break;
      const payload = this.buffer.subarray(4, length + 4);
      this.buffer = this.buffer.subarray(length + 4);
      messages.push(this.schema.parse(decode(payload)));
    }
    return messages;
  }
}

export class TerminalSidecarClientFrameDecoder extends FrameDecoder {
  constructor() {
    super(TerminalSidecarClientMessageSchema);
  }
}

export class TerminalSidecarServerFrameDecoder extends FrameDecoder {
  constructor() {
    super(TerminalSidecarServerMessageSchema);
  }
}

function encodeFrame(message) {
  const payload = Buffer.from(encode(message));
  if (payload.byteLength > SeneraTerminalSidecarMaxFrameBytes) {
    throw new RangeError(`Terminal sidecar frame exceeds ${SeneraTerminalSidecarMaxFrameBytes} bytes.`);
  }
  const frame = Buffer.allocUnsafe(payload.byteLength + 4);
  frame.writeUInt32BE(payload.byteLength, 0);
  payload.copy(frame, 4);
  return frame;
}
