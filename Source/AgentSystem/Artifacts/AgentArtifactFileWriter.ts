import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable, Transform, type Duplex, type TransformCallback } from "node:stream";
import { SeneraWorkspaceBoundary, SeneraWorkspaceBoundaryError } from "../Execution/SeneraWorkspaceBoundary.js";
import { AgentResourceAccessIntents, type AgentResourceAccessIntent } from "../Safety/AgentResourceAccessPolicy.js";
import { writeFileAtomic } from "../Core/AgentFs.js";
import {
  openVerifiedArtifactFile,
  type AgentArtifactContentIdentity,
  type AgentArtifactFileReceipt,
} from "./AgentArtifactIntegrity.js";

export const AgentArtifactDirectoryReservations = {
  Created: "created",
  Existing: "existing",
} as const;

export type AgentArtifactDirectoryReservation =
  (typeof AgentArtifactDirectoryReservations)[keyof typeof AgentArtifactDirectoryReservations];

export class AgentArtifactFileWriter {
  private readonly boundary: SeneraWorkspaceBoundary;

  constructor(workspaceRoot: string) {
    this.boundary = new SeneraWorkspaceBoundary({ workspaceRoot, linkPolicy: "deny" });
  }

  async writeJson(filePath: string, value: unknown): Promise<AgentArtifactFileReceipt> {
    return this.writeJsonStream(filePath, value);
  }

  async publishJson(filePath: string, value: unknown): Promise<AgentArtifactFileReceipt> {
    const target = await this.prepareTarget(filePath, AgentResourceAccessIntents.Create);
    const temporary = path.join(path.dirname(target.absolutePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
    try {
      const receipt = await this.writeJsonSource(temporary, value);
      await fs.link(temporary, target.absolutePath);
      return { filePath: target.absolutePath, ...receipt };
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async reserveArtifactDirectory(directoryPath: string): Promise<AgentArtifactDirectoryReservation> {
    const target = await this.boundary.resolve(directoryPath, AgentResourceAccessIntents.Create);
    await fs.mkdir(path.dirname(target.absolutePath), { recursive: true });
    const current = await this.boundary.resolve(directoryPath, AgentResourceAccessIntents.Create);
    try {
      await fs.mkdir(current.absolutePath);
      return AgentArtifactDirectoryReservations.Created;
    } catch (error) {
      const detail = error as NodeJS.ErrnoException;
      if (detail.code === "EEXIST") {
        return AgentArtifactDirectoryReservations.Existing;
      }
      throw error;
    }
  }

  async readVerifiedText(filePath: string, expected: AgentArtifactContentIdentity): Promise<string> {
    const handle = await openVerifiedArtifactFile(this.boundary, filePath, expected);
    try {
      return await handle.readFile({ encoding: "utf8" });
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  async writeBoundedJson(filePath: string, value: unknown, maxBytes: number): Promise<AgentArtifactFileReceipt> {
    assertJsonBudget(maxBytes);
    const target = await this.prepareTarget(filePath);
    const source = path.join(path.dirname(target.absolutePath), `.${path.basename(filePath)}.${randomUUID()}.source`);
    try {
      const totalBytes = await this.writeJsonSource(source, value);
      if (totalBytes.byteLength <= maxBytes) {
        await fs.rename(source, target.absolutePath);
        return { filePath: target.absolutePath, ...totalBytes };
      }
      const preview = await readUtf8Prefix(source, maxBytes);
      await fs.rm(source, { force: true });
      const bounded = fitJsonPreview({ truncated: true, originalBytes: totalBytes.byteLength, preview }, maxBytes);
      return this.writeJsonStream(filePath, bounded);
    } finally {
      await fs.rm(source, { force: true }).catch(() => undefined);
    }
  }

  async writeText(filePath: string, value: string, maxBytes: number): Promise<AgentArtifactFileReceipt> {
    const target = await this.prepareTarget(filePath);
    assertJsonBudget(maxBytes);
    const text = truncateArtifactTextByBytes(value, maxBytes);
    await writeFileAtomic(target.absolutePath, text);
    const content = Buffer.from(text, "utf8");
    return {
      filePath: target.absolutePath,
      byteLength: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex"),
    };
  }

  private async writeJsonStream(filePath: string, value: unknown): Promise<AgentArtifactFileReceipt> {
    const target = await this.prepareTarget(filePath);
    const temporary = path.join(path.dirname(target.absolutePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
    try {
      const receipt = await this.writeJsonSource(temporary, value);
      await fs.rename(temporary, target.absolutePath);
      return { filePath: target.absolutePath, ...receipt };
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  private async writeJsonSource(filePath: string, value: unknown): Promise<Omit<AgentArtifactFileReceipt, "filePath">> {
    let bytes = 0;
    const hash = createHash("sha256");
    const source = Readable.from(
      (function* () {
        for (const chunk of encodeJson(value)) {
          const encoded = Buffer.from(chunk, "utf8");
          bytes += encoded.byteLength;
          hash.update(encoded);
          yield chunk;
        }
        bytes += 1;
        hash.update("\n");
        yield "\n";
      })(),
    );
    await pipeline(source, createWriteStream(filePath, { flags: "wx", encoding: "utf8" }));
    return { byteLength: bytes, sha256: hash.digest("hex") };
  }

  private async prepareTarget(
    filePath: string,
    intent: AgentResourceAccessIntent = AgentResourceAccessIntents.Replace,
  ): Promise<{ absolutePath: string }> {
    const initial = await this.boundary.resolve(filePath, intent);
    await fs.mkdir(path.dirname(initial.absolutePath), { recursive: true });
    return this.boundary.resolve(filePath, intent);
  }

  async copyFile(sourcePath: string, targetPath: string): Promise<AgentArtifactFileReceipt> {
    return this.copyFileStream(sourcePath, targetPath);
  }

  async copyFileWithTransform(
    sourcePath: string,
    targetPath: string,
    transform: Duplex,
  ): Promise<AgentArtifactFileReceipt> {
    return this.copyFileStream(sourcePath, targetPath, transform);
  }

  private async copyFileStream(
    sourcePath: string,
    targetPath: string,
    transform?: Duplex,
  ): Promise<AgentArtifactFileReceipt> {
    const source = await this.boundary.openFile(sourcePath, AgentResourceAccessIntents.Read);
    const target = await this.boundary.resolve(targetPath, AgentResourceAccessIntents.Replace);
    await fs.mkdir(path.dirname(target.absolutePath), { recursive: true });
    const temporary = path.join(path.dirname(target.absolutePath), `.${path.basename(targetPath)}.${randomUUID()}.tmp`);
    const readStream = source.handle.createReadStream({ autoClose: false });
    try {
      const output = createWriteStream(temporary, { flags: "wx" });
      const digest = new ArtifactDigestTransform();
      if (transform) await pipeline(readStream, transform, digest, output);
      else await pipeline(readStream, digest, output);
      const current = await this.boundary.resolve(targetPath, AgentResourceAccessIntents.Replace);
      if (current.absolutePath !== target.absolutePath) {
        throw new SeneraWorkspaceBoundaryError("path_changed", `Artifact target changed while copying: ${targetPath}`);
      }
      await fs.rename(temporary, current.absolutePath);
      return digest.receipt(current.absolutePath);
    } finally {
      readStream.destroy();
      await source.handle.close().catch(() => undefined);
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}

class ArtifactDigestTransform extends Transform {
  private readonly hash = createHash("sha256");
  private bytes = 0;

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.bytes += chunk.byteLength;
    this.hash.update(chunk);
    callback(undefined, chunk);
  }

  receipt(filePath: string): AgentArtifactFileReceipt {
    return { filePath, byteLength: this.bytes, sha256: this.hash.digest("hex") };
  }
}

export function truncateArtifactText(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, Math.max(0, maxChars - 13))}\n[truncated]` : value;
}

export function truncateArtifactTextByBytes(value: string, maxBytes: number): string {
  assertJsonBudget(maxBytes);
  if (byteLength(value) <= maxBytes) return value;
  const marker = "\n[truncated]\n";
  if (byteLength(marker) >= maxBytes) return Buffer.from(marker).subarray(0, maxBytes).toString("utf8");
  const source = Buffer.from(value, "utf8");
  let end = Math.max(0, maxBytes - byteLength(marker));
  while (end > 0 && (source[end] & 0xc0) === 0x80) end -= 1;
  return `${source.subarray(0, end).toString("utf8")}${marker}`;
}

function fitJsonPreview(value: { truncated: true; originalBytes: number; preview: string }, maxBytes: number) {
  let low = 0;
  let high = value.preview.length;
  let best = { ...value, preview: "" };
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = { ...value, preview: value.preview.slice(0, mid) };
    if (byteLength(`${JSON.stringify(candidate)}\n`) <= maxBytes) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function assertJsonBudget(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RangeError(`JSON byte budget must be a positive safe integer: ${value}`);
}

async function readUtf8Prefix(filePath: string, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let remaining = maxBytes;
  for await (const chunk of createReadStream(filePath)) {
    if (remaining <= 0) break;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const retained = buffer.subarray(0, remaining);
    chunks.push(retained);
    remaining -= retained.byteLength;
  }
  return Buffer.concat(chunks).toString("utf8");
}

function* encodeJson(value: unknown, stack = new Set<object>()): Generator<string> {
  if (value === null) {
    yield "null";
    return;
  }
  switch (typeof value) {
    case "string":
      yield JSON.stringify(value);
      return;
    case "number":
      yield Number.isFinite(value) ? String(value) : "null";
      return;
    case "boolean":
      yield value ? "true" : "false";
      return;
    case "bigint":
      throw new TypeError("Do not know how to serialize a BigInt");
    case "undefined":
    case "function":
    case "symbol":
      yield "null";
      return;
  }

  const object = value as object & { toJSON?: () => unknown };
  if (typeof object.toJSON === "function") {
    yield* encodeJson(object.toJSON(), stack);
    return;
  }
  if (stack.has(object)) throw new TypeError("Converting circular structure to JSON");
  stack.add(object);
  try {
    if (Array.isArray(object)) {
      yield "[";
      for (const [index, entry] of object.entries()) {
        if (index > 0) yield ",";
        yield* encodeJson(entry, stack);
      }
      yield "]";
      return;
    }
    yield "{";
    let first = true;
    for (const [key, entry] of Object.entries(object)) {
      if (entry === undefined || typeof entry === "function" || typeof entry === "symbol") continue;
      if (!first) yield ",";
      first = false;
      yield JSON.stringify(key);
      yield ":";
      yield* encodeJson(entry, stack);
    }
    yield "}";
  } finally {
    stack.delete(object);
  }
}
