import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type SeneraOutputStream = "stdout" | "stderr";
export const SeneraOutputSpoolMarkerFileName = ".output-spool.json";

export type SeneraOutputSpoolState = "open" | "sealed" | "failed" | "committed";

export interface SeneraOutputSpoolMetadata {
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly toolCallId?: string;
}

export interface SeneraOutputSpoolDescriptor {
  readonly directory: string;
  readonly files: Readonly<Record<SeneraOutputStream, string>>;
  readonly truncated: Record<SeneraOutputStream, boolean>;
}

/**
 * Asynchronously captures process output without retaining the complete output
 * in JavaScript memory. The underlying write streams provide backpressure to
 * the process backends.
 */
export interface SeneraOutputSpool {
  readonly descriptor: SeneraOutputSpoolDescriptor;
  write(stream: SeneraOutputStream, data: Uint8Array): boolean;
  waitForDrain(stream: SeneraOutputStream): Promise<void>;
  close(): Promise<void>;
  cleanup(): Promise<void>;
}

export async function createSeneraOutputSpool(
  rootDirectory: string,
  id: string,
  options: { maxBytes?: number; metadata?: SeneraOutputSpoolMetadata } = {},
): Promise<SeneraOutputSpool> {
  validateMaxBytes(options.maxBytes);
  const directory = path.resolve(rootDirectory, id);
  await fsp.mkdir(directory, { recursive: true });
  const markerPath = path.join(directory, SeneraOutputSpoolMarkerFileName);
  await writeSpoolMarker(markerPath, {
    schemaVersion: 1,
    kind: "senera-output-spool",
    state: "open",
    createdAt: new Date().toISOString(),
    ...options.metadata,
  });
  const files = {
    stdout: path.join(directory, "stdout.txt"),
    stderr: path.join(directory, "stderr.txt"),
  } as const;
  const streams = {
    stdout: fs.createWriteStream(files.stdout, { flags: "wx" }),
    stderr: fs.createWriteStream(files.stderr, { flags: "wx" }),
  } as const;
  return new FileOutputSpool(
    {
      directory,
      files,
      truncated: { stdout: false, stderr: false },
    },
    streams,
    options.maxBytes,
    markerPath,
  );
}

class FileOutputSpool implements SeneraOutputSpool {
  private closed = false;
  private closePromise: Promise<void> | undefined;

  constructor(
    readonly descriptor: SeneraOutputSpoolDescriptor,
    private readonly streams: Readonly<Record<SeneraOutputStream, fs.WriteStream>>,
    private readonly maxBytes: number | undefined,
    private readonly markerPath: string,
  ) {
    Object.values(this.streams).forEach((stream) => {
      stream.on("error", (error) => this.streamErrors.set(stream, error));
    });
  }

  private readonly writtenBytes = { stdout: 0, stderr: 0 };
  private readonly streamErrors = new Map<fs.WriteStream, Error>();

  write(stream: SeneraOutputStream, data: Uint8Array): boolean {
    if (this.closed) throw new Error("output spool is already closed");
    const streamError = this.streamErrors.get(this.streams[stream]);
    if (streamError) throw streamError;
    const available =
      this.maxBytes === undefined ? data.byteLength : Math.max(0, this.maxBytes - this.writtenBytes[stream]);
    const retained = data.subarray(0, available);
    this.writtenBytes[stream] += retained.byteLength;
    if (retained.byteLength < data.byteLength) {
      this.descriptor.truncated[stream] = true;
    }
    if (retained.byteLength === 0) return true;
    return this.streams[stream].write(Buffer.from(retained));
  }

  waitForDrain(stream: SeneraOutputStream): Promise<void> {
    const target = this.streams[stream];
    if (!target.writableNeedDrain) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const onDrain = (): void => {
        cleanup();
        resolve();
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      const cleanup = (): void => {
        target.off("drain", onDrain);
        target.off("error", onError);
      };
      target.once("drain", onDrain);
      target.once("error", onError);
    });
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    const streamError = [...this.streamErrors.values()][0];
    if (streamError) {
      this.closePromise = Promise.reject(streamError);
      return this.closePromise;
    }
    this.closePromise = Promise.all(
      Object.values(this.streams).map(
        (stream) =>
          new Promise<void>((resolve, reject) => {
            const onFinish = (): void => {
              cleanup();
              resolve();
            };
            const onError = (error: Error): void => {
              cleanup();
              reject(error);
            };
            const cleanup = (): void => {
              stream.off("finish", onFinish);
              stream.off("error", onError);
            };
            stream.once("finish", onFinish);
            stream.once("error", onError);
            stream.end();
          }),
      ),
    ).then(async () => {
      await updateSpoolMarkerState(this.markerPath, "sealed");
    });
    return this.closePromise;
  }

  async cleanup(): Promise<void> {
    await this.close().catch(() => undefined);
    await fsp.rm(this.descriptor.directory, { recursive: true, force: true });
  }
}

export async function updateSeneraOutputSpoolState(
  descriptor: Pick<SeneraOutputSpoolDescriptor, "directory">,
  state: SeneraOutputSpoolState,
): Promise<void> {
  await updateSpoolMarkerState(path.join(descriptor.directory, SeneraOutputSpoolMarkerFileName), state);
}

async function updateSpoolMarkerState(markerPath: string, state: SeneraOutputSpoolState): Promise<void> {
  const marker = await fsp
    .readFile(markerPath, "utf8")
    .then((value) => JSON.parse(value) as Record<string, unknown>)
    .catch(() => ({
      schemaVersion: 1,
      kind: "senera-output-spool",
      createdAt: new Date().toISOString(),
    }));
  await writeSpoolMarker(markerPath, {
    ...marker,
    state,
    updatedAt: new Date().toISOString(),
  });
}

async function writeSpoolMarker(markerPath: string, marker: Record<string, unknown>): Promise<void> {
  const temporaryPath = `${markerPath}.${randomUUID()}.tmp`;
  try {
    await fsp.writeFile(temporaryPath, `${JSON.stringify(marker)}\n`, { encoding: "utf8", flag: "wx" });
    await fsp.rename(temporaryPath, markerPath);
  } finally {
    await fsp.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function validateMaxBytes(value: number | undefined): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
    throw new RangeError("output spool maxBytes must be a positive safe integer.");
  }
}
