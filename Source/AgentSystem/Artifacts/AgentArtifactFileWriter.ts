import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { Transform } from "node:stream";
import { SeneraWorkspaceBoundary, SeneraWorkspaceBoundaryError } from "../Execution/SeneraWorkspaceBoundary.js";
import { AgentResourceAccessIntents } from "../Safety/AgentResourceAccessPolicy.js";

export class AgentArtifactFileWriter {
  private readonly boundary: SeneraWorkspaceBoundary;

  constructor(workspaceRoot: string) {
    this.boundary = new SeneraWorkspaceBoundary({ workspaceRoot, linkPolicy: "deny" });
  }

  async writeJson(filePath: string, value: unknown): Promise<void> {
    await this.writeJsonStream(filePath, value);
  }

  async writeBoundedJson(filePath: string, value: unknown, maxBytes: number): Promise<void> {
    assertJsonBudget(maxBytes);
    const target = await this.prepareTarget(filePath);
    const source = path.join(path.dirname(target.absolutePath), `.${path.basename(filePath)}.${randomUUID()}.source`);
    try {
      const totalBytes = await this.writeJsonSource(source, value);
      if (totalBytes <= maxBytes) {
        await fs.rename(source, target.absolutePath);
        return;
      }
      const preview = await readUtf8Prefix(source, maxBytes);
      await fs.rm(source, { force: true });
      await this.writeJsonStream(filePath, {
        truncated: true,
        originalBytes: totalBytes,
        preview: truncateArtifactText(preview, maxBytes),
      });
    } finally {
      await fs.rm(source, { force: true }).catch(() => undefined);
    }
  }

  async writeText(filePath: string, value: string, maxBytes: number): Promise<void> {
    const target = await this.prepareTarget(filePath);
    const text =
      byteLength(value) > maxBytes
        ? `${Buffer.from(value).subarray(0, maxBytes).toString("utf8")}\n[truncated]\n`
        : value;
    const temporary = path.join(path.dirname(target.absolutePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, text, { encoding: "utf8", flag: "wx" });
      await fs.rename(temporary, target.absolutePath);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  private async writeJsonStream(filePath: string, value: unknown): Promise<void> {
    const target = await this.prepareTarget(filePath);
    const temporary = path.join(path.dirname(target.absolutePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
    try {
      await this.writeJsonSource(temporary, value);
      await fs.rename(temporary, target.absolutePath);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  private async writeJsonSource(filePath: string, value: unknown): Promise<number> {
    let bytes = 0;
    const source = Readable.from(
      (function* () {
        for (const chunk of encodeJson(value)) {
          bytes += Buffer.byteLength(chunk, "utf8");
          yield chunk;
        }
        bytes += 1;
        yield "\n";
      })(),
    );
    await pipeline(source, createWriteStream(filePath, { flags: "wx", encoding: "utf8" }));
    return bytes;
  }

  private async prepareTarget(filePath: string): Promise<{ absolutePath: string }> {
    const initial = await this.boundary.resolve(filePath, AgentResourceAccessIntents.Replace);
    await fs.mkdir(path.dirname(initial.absolutePath), { recursive: true });
    return this.boundary.resolve(filePath, AgentResourceAccessIntents.Replace);
  }

  async copyFile(sourcePath: string, targetPath: string): Promise<void> {
    await this.copyFileStream(sourcePath, targetPath);
  }

  async copyFileWithTransform(sourcePath: string, targetPath: string, transform: Transform): Promise<void> {
    await this.copyFileStream(sourcePath, targetPath, transform);
  }

  private async copyFileStream(sourcePath: string, targetPath: string, transform?: Transform): Promise<void> {
    const source = await this.boundary.openFile(sourcePath, AgentResourceAccessIntents.Read);
    const target = await this.boundary.resolve(targetPath, AgentResourceAccessIntents.Replace);
    await fs.mkdir(path.dirname(target.absolutePath), { recursive: true });
    const temporary = path.join(path.dirname(target.absolutePath), `.${path.basename(targetPath)}.${randomUUID()}.tmp`);
    const readStream = source.handle.createReadStream({ autoClose: false });
    try {
      const output = createWriteStream(temporary, { flags: "wx" });
      if (transform) await pipeline(readStream, transform, output);
      else await pipeline(readStream, output);
      const current = await this.boundary.resolve(targetPath, AgentResourceAccessIntents.Replace);
      if (current.absolutePath !== target.absolutePath) {
        throw new SeneraWorkspaceBoundaryError("path_changed", `Artifact target changed while copying: ${targetPath}`);
      }
      await fs.rename(temporary, current.absolutePath);
    } finally {
      readStream.destroy();
      await source.handle.close().catch(() => undefined);
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}

export function truncateArtifactText(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, Math.max(0, maxChars - 13))}\n[truncated]` : value;
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
