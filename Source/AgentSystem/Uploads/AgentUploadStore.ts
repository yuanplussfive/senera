import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Transform, type TransformCallback, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  AgentUploadFileNames,
  createAgentUploadId,
  formatAgentUploadUri,
  normalizeAgentUploadUri,
  parseAgentUploadUri,
  resolveAgentUploadDir,
  resolveAgentUploadFile,
  resolveAgentUploadRoot,
} from "./AgentUploadLocator.js";
import { detectAgentUploadMime } from "./AgentUploadMime.js";
import {
  AgentUploadAttachment,
  AgentUploadManifest,
  AgentUploadManifestSchema,
  AgentUploadStatus,
  type AgentResolvedUpload,
} from "./AgentUploadTypes.js";

export class AgentUploadError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "AgentUploadError";
  }
}

export interface AgentUploadStoreOptions {
  workspaceRoot: string;
  rootDir: string;
  maxFileBytes: number;
}

export interface AgentUploadSaveInput {
  stream: Readable;
  originalName: string;
  declaredMime?: string;
}

export class AgentUploadStore {
  constructor(private readonly options: AgentUploadStoreOptions) {}

  get maxFileBytes(): number {
    return this.options.maxFileBytes;
  }

  async save(input: AgentUploadSaveInput): Promise<AgentUploadAttachment> {
    const uploadId = createAgentUploadId();
    const uploadUri = formatAgentUploadUri(uploadId);
    const uploadRoot = this.resolveRoot();
    const uploadDir = resolveAgentUploadDir(uploadRoot, uploadId);
    const filePath = resolveAgentUploadFile(uploadRoot, uploadId, AgentUploadFileNames.Original);
    const meter = new UploadByteMeter(this.options.maxFileBytes);

    await fsp.mkdir(uploadDir, { recursive: true });

    try {
      await pipeline(input.stream, meter, fs.createWriteStream(filePath));
      const mime = await detectAgentUploadMime({
        filePath,
        originalName: input.originalName,
        declaredMime: input.declaredMime,
      });
      const manifest: AgentUploadManifest = {
        uploadId,
        uploadUri,
        name: sanitizeUploadDisplayName(input.originalName),
        mime: mime.effective,
        declaredMime: mime.declared,
        detectedMime: mime.detected,
        size: meter.byteLength,
        sha256: meter.sha256(),
        createdAt: new Date().toISOString(),
        storage: {
          fileName: AgentUploadFileNames.Original,
        },
      };
      await this.writeManifest(uploadDir, manifest);
      return manifestToAttachment(manifest);
    } catch (error) {
      await fsp.rm(uploadDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  async resolve(uploadUri: string): Promise<AgentResolvedUpload | undefined> {
    const normalizedUri = normalizeAgentUploadUri(uploadUri);
    if (!normalizedUri) {
      return undefined;
    }

    const uploadId = parseAgentUploadUri(normalizedUri);
    if (!uploadId) {
      return undefined;
    }

    const uploadRoot = this.resolveRoot();
    const uploadDir = resolveAgentUploadDir(uploadRoot, uploadId);
    const manifestPath = resolveAgentUploadFile(uploadRoot, uploadId, AgentUploadFileNames.Manifest);
    const manifest = AgentUploadManifestSchema.parse(
      JSON.parse(await fsp.readFile(manifestPath, "utf8")),
    );
    if (manifest.uploadUri !== normalizedUri || manifest.uploadId !== uploadId) {
      return undefined;
    }

    return {
      manifest,
      uploadDir,
      filePath: resolveAgentUploadFile(uploadRoot, uploadId, manifest.storage.fileName),
    };
  }

  private resolveRoot(): string {
    return resolveAgentUploadRoot(this.options.workspaceRoot, this.options.rootDir);
  }

  private async writeManifest(uploadDir: string, manifest: AgentUploadManifest): Promise<void> {
    await fsp.writeFile(
      path.join(uploadDir, AgentUploadFileNames.Manifest),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
  }
}

export function manifestToAttachment(manifest: AgentUploadManifest): AgentUploadAttachment {
  return {
    uploadUri: manifest.uploadUri,
    name: manifest.name,
    mime: manifest.mime,
    size: manifest.size,
    sha256: manifest.sha256,
    status: AgentUploadStatus.Uploaded,
  };
}

function sanitizeUploadDisplayName(value: string): string {
  const name = path.basename(path.win32.basename(value.trim())).normalize("NFC");
  return name ? name : "uploaded-file";
}

class UploadByteMeter extends Transform {
  private readonly hash = crypto.createHash("sha256");
  byteLength = 0;

  constructor(private readonly maxFileBytes: number) {
    super();
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.byteLength += chunk.byteLength;
    if (this.byteLength > this.maxFileBytes) {
      callback(new AgentUploadError("上传文件超过大小限制。", "upload_too_large", 413));
      return;
    }

    this.hash.update(chunk);
    callback(null, chunk);
  }

  sha256(): string {
    return this.hash.digest("hex");
  }
}
