import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform, type Readable } from "node:stream";
import yauzl from "yauzl";
import {
  AgentClientExtensionLimits,
  AgentClientExtensionManifestFile,
  AgentClientExtensionManifestSchema,
  AgentClientExtensionDigestSchema,
  isClientExtensionPath,
  type AgentClientExtensionManifest,
  type AgentClientExtensionStatus,
} from "./AgentClientExtensionContract.js";

export class AgentClientExtensionStore {
  private pending: Promise<unknown> = Promise.resolve();
  private readonly manifests = new Map<string, AgentClientExtensionManifest>();
  constructor(readonly root: string) {}

  read(id: string): AgentClientExtensionStatus {
    const file = path.join(this.directory(id), "active.json");
    if (!fs.existsSync(file)) return { id, installed: false };
    const revision = AgentClientExtensionDigestSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
    const manifest = this.release(id, revision);
    if (!manifest) throw new Error("The active client extension revision is missing.");
    return { id, installed: true, manifest };
  }

  publicRoot(manifest: AgentClientExtensionManifest): string {
    return path.join(this.directory(manifest.id), "releases", manifest.revision, "public");
  }

  release(id: string, revision?: string): AgentClientExtensionManifest | undefined {
    if (!revision) return this.read(id).manifest;
    AgentClientExtensionDigestSchema.parse(revision);
    const key = `${id}/${revision}`;
    const cached = this.manifests.get(key);
    if (cached) return cached;
    const file = path.join(this.directory(id), "releases", revision, "manifest.json");
    if (!fs.existsSync(file)) return undefined;
    const manifest = AgentClientExtensionManifestSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
    if (manifest.id !== id || manifest.revision !== revision) throw new Error("Invalid installed extension identity.");
    this.manifests.set(key, manifest);
    return manifest;
  }

  install(id: string, archive: Buffer): Promise<AgentClientExtensionManifest> {
    return this.exclusive(() => this.installArchive(id, archive));
  }

  private async installArchive(id: string, archive: Buffer): Promise<AgentClientExtensionManifest> {
    if (archive.length > AgentClientExtensionLimits.archiveBytes)
      throw new Error("The client extension archive is too large.");
    const directory = this.directory(id);
    const stage = path.join(directory, `.install-${randomUUID()}`);
    await mkdir(path.join(stage, "public"), { recursive: true });
    try {
      const manifest = await extractVerifiedArchive(archive, path.join(stage, "public"), id);
      await writeFile(path.join(stage, "manifest.json"), JSON.stringify(manifest));
      const target = path.dirname(this.publicRoot(manifest));
      await mkdir(path.dirname(target), { recursive: true });
      if (fs.existsSync(target)) await rm(stage, { recursive: true, force: true });
      else await rename(stage, target);
      const pointer = path.join(directory, `.active-${randomUUID()}.json`);
      await writeFile(pointer, JSON.stringify(manifest.revision));
      await rename(pointer, path.join(directory, "active.json"));
      this.manifests.set(`${id}/${manifest.revision}`, manifest);
      return manifest;
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  }

  remove(id: string): Promise<void> {
    return this.exclusive(async () => {
      await rm(this.directory(id), { recursive: true, force: true });
      for (const key of this.manifests.keys()) if (key.startsWith(`${id}/`)) this.manifests.delete(key);
    });
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => undefined);
    return result;
  }

  private directory(id: string): string {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) throw new Error("Invalid client extension identity.");
    return path.join(path.resolve(this.root), id);
  }
}

async function extractVerifiedArchive(
  archive: Buffer,
  destination: string,
  id: string,
): Promise<AgentClientExtensionManifest> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.fromBuffer(archive, { lazyEntries: true, strictFileNames: true }, (error, result) =>
      error ? reject(error) : resolve(result),
    ),
  );
  let manifest: AgentClientExtensionManifest | undefined;
  const inventory = new Map<string, AgentClientExtensionManifest["files"][number]>();
  const seen = new Set<string>();
  return new Promise((resolve, reject) => {
    const fail = (error: unknown): void => {
      zip.close();
      reject(error);
    };
    zip.on("error", fail);
    zip.on("entry", (entry: yauzl.Entry) => {
      void (async () => {
        if (!isClientExtensionPath(entry.fileName) || seen.has(entry.fileName))
          throw new Error("Invalid or duplicate archive path.");
        const kind = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (kind !== 0 && kind !== 0o100000) throw new Error("Client extensions cannot contain links or directories.");
        if (entry.generalPurposeBitFlag & 1) throw new Error("Encrypted client extensions are not supported.");
        seen.add(entry.fileName);
        const stream = await new Promise<Readable>((accept, refuse) =>
          zip.openReadStream(entry, (error, value) => (error ? refuse(error) : accept(value))),
        );
        if (!manifest) {
          if (
            entry.fileName !== AgentClientExtensionManifestFile ||
            entry.uncompressedSize > AgentClientExtensionLimits.manifestBytes
          )
            throw new Error("The first archive entry must be the client extension manifest.");
          const chunks: Buffer[] = [];
          let bytes = 0;
          for await (const chunk of stream) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytes += buffer.length;
            if (bytes > AgentClientExtensionLimits.manifestBytes)
              throw new Error("The client extension manifest is too large.");
            chunks.push(buffer);
          }
          manifest = AgentClientExtensionManifestSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          if (manifest.id !== id) throw new Error("This archive belongs to a different client extension.");
          for (const file of manifest.files) inventory.set(file.path, file);
          if (createHash("sha256").update(JSON.stringify(manifest.files)).digest("hex") !== manifest.revision)
            throw new Error("The extension revision does not match its inventory.");
          if (zip.entryCount !== manifest.files.length + 1)
            throw new Error("The client extension file inventory does not match.");
        } else {
          const asset = inventory.get(entry.fileName);
          if (!asset || entry.uncompressedSize !== asset.bytes)
            throw new Error(`Undeclared or invalid extension asset: ${entry.fileName}`);
          const target = path.join(destination, ...asset.path.split("/"));
          await mkdir(path.dirname(target), { recursive: true });
          const hash = createHash("sha256");
          let bytes = 0;
          await pipeline(
            stream,
            new Transform({
              transform(chunk: Buffer, _encoding, callback) {
                bytes += chunk.length;
                if (bytes > asset.bytes) {
                  callback(new Error("The extension asset exceeds its declared size."));
                  return;
                }
                hash.update(chunk);
                callback(null, chunk);
              },
            }),
            fs.createWriteStream(target, { flags: "wx" }),
          );
          if (bytes !== asset.bytes || hash.digest("hex") !== asset.sha256)
            throw new Error(`Client extension integrity check failed: ${asset.path}`);
        }
        zip.readEntry();
      })().catch(fail);
    });
    zip.on("end", () => {
      if (!manifest || manifest.files.some((file) => !seen.has(file.path)))
        fail(new Error("Incomplete client extension archive."));
      else resolve(manifest);
    });
    zip.readEntry();
  });
}

export async function readClientExtensionBytes(stream: AsyncIterable<Uint8Array>, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stream) {
    bytes += chunk.length;
    if (bytes > limit) throw new Error("Client data exceeds its allowed size.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
