import {
  decodeSeneraProcessOutput,
  type SeneraProcessOutputDecoderOptions,
} from "./SeneraProcessOutputDecoder.js";

export class SeneraProcessOutputBuffer {
  private readonly stdoutChunks: Buffer[] = [];
  private readonly stderrChunks: Buffer[] = [];
  stdoutBytes = 0;
  stderrBytes = 0;

  constructor(private readonly options: SeneraProcessOutputDecoderOptions = {}) {}

  pushStdout(chunk: Buffer | string): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.stdoutChunks.push(buffer);
    this.stdoutBytes += buffer.byteLength;
  }

  pushStderr(chunk: Buffer | string): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.stderrChunks.push(buffer);
    this.stderrBytes += buffer.byteLength;
  }

  stdout(): string {
    return decodeSeneraProcessOutput(Buffer.concat(this.stdoutChunks), this.options);
  }

  stderr(): string {
    return decodeSeneraProcessOutput(Buffer.concat(this.stderrChunks), this.options);
  }
}
