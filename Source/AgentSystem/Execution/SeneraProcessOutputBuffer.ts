import { decodeSeneraProcessOutput, type SeneraProcessOutputDecoderOptions } from "./SeneraProcessOutputDecoder.js";

export interface SeneraProcessOutputBufferOptions extends SeneraProcessOutputDecoderOptions {
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  truncationMarker?: string;
}

export class SeneraProcessOutputBuffer {
  private readonly stdoutBuffer: BoundedByteBuffer;
  private readonly stderrBuffer: BoundedByteBuffer;
  stdoutBytes = 0;
  stderrBytes = 0;

  constructor(private readonly options: SeneraProcessOutputBufferOptions = {}) {
    this.stdoutBuffer = new BoundedByteBuffer(options.maxStdoutBytes);
    this.stderrBuffer = new BoundedByteBuffer(options.maxStderrBytes);
  }

  get stdoutTruncated(): boolean {
    return this.stdoutBuffer.truncated;
  }

  get stderrTruncated(): boolean {
    return this.stderrBuffer.truncated;
  }

  pushStdout(chunk: Buffer | string): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.stdoutBuffer.push(buffer);
    this.stdoutBytes += buffer.byteLength;
  }

  pushStderr(chunk: Buffer | string): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.stderrBuffer.push(buffer);
    this.stderrBytes += buffer.byteLength;
  }

  stdout(): string {
    return this.decode(this.stdoutBuffer);
  }

  stderr(): string {
    return this.decode(this.stderrBuffer);
  }

  private decode(buffer: BoundedByteBuffer): string {
    const retained = buffer.value();
    if (!buffer.truncated) return decodeSeneraProcessOutput(retained, this.options);
    const marker = this.options.truncationMarker ?? "\n... Senera output truncated ...\n";
    const head = decodeSeneraProcessOutput(retained.subarray(0, buffer.headBytes), this.options);
    const tail = decodeSeneraProcessOutput(retained.subarray(buffer.headBytes), this.options);
    return `${head}${marker}${tail}`;
  }
}

class BoundedByteBuffer {
  private chunks: Buffer[] = [];
  private retained?: Buffer;
  private _truncated = false;
  private _headBytes = 0;

  constructor(private readonly maxBytes: number | undefined) {}

  get truncated(): boolean {
    return this._truncated;
  }

  get headBytes(): number {
    return this._headBytes;
  }

  push(chunk: Buffer): void {
    if (this.maxBytes === undefined) {
      this.chunks.push(chunk);
      return;
    }

    const current = this.value();
    if (!this._truncated && current.byteLength + chunk.byteLength <= this.maxBytes) {
      this.retained = Buffer.concat([current, chunk]);
      this.chunks = [];
      return;
    }

    this._truncated = true;
    const headLimit = Math.ceil(this.maxBytes / 2);
    const tailLimit = Math.max(0, this.maxBytes - headLimit);
    const headBytes = this._headBytes > 0 ? this._headBytes : headLimit;
    const head = Buffer.allocUnsafe(headBytes);
    const previousHead = current.subarray(0, Math.min(current.byteLength, headBytes));
    previousHead.copy(head);
    if (previousHead.byteLength < headBytes) {
      chunk.subarray(0, headBytes - previousHead.byteLength).copy(head, previousHead.byteLength);
    }
    const tail = Buffer.allocUnsafe(tailLimit);
    if (tailLimit > 0) {
      if (chunk.byteLength >= tailLimit) {
        chunk.subarray(chunk.byteLength - tailLimit).copy(tail);
      } else {
        const fromPrevious = Math.min(current.byteLength, tailLimit - chunk.byteLength);
        current.subarray(current.byteLength - fromPrevious).copy(tail);
        chunk.copy(tail, fromPrevious);
      }
    }
    this._headBytes = head.byteLength;
    this.retained = Buffer.concat([head, tail]);
    this.chunks = [];
  }

  value(): Buffer {
    return this.retained ?? Buffer.concat(this.chunks);
  }
}
