import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { extension } from "mime-types";
import { fileTypeFromBuffer } from "file-type";
import type { CommonTypes } from "onebots";
import { writeFileAtomic } from "../../Core/AgentFs.js";
import { decodeBase64Attachment } from "../AgentChannelAttachmentIngestor.js";
import { AgentChannelOutboundMediaDefaults } from "../AgentChannelOutboundMedia.js";
import type { AgentChannelAttachment, AgentChannelMedia } from "../AgentChannelTypes.js";
import { isMediaSegmentType } from "./AgentOneBot11MessageProjection.js";
import { normalizeAgentResourceUri } from "../../Resources/AgentResourceUri.js";
import type { AgentUploadStore } from "../../Uploads/AgentUploadStore.js";

/** Legacy inline media is gateway-owned; shared uploads retain their canonical identity. */
export class AgentOneBot11MediaStore {
  readonly directory: string;

  constructor(
    runtimeDirectory: string,
    private readonly origin: string,
    private readonly uploads?: Pick<AgentUploadStore, "resolve">,
  ) {
    this.directory = path.join(runtimeDirectory, "media");
  }

  async importSegments(segments: readonly CommonTypes.Segment[]): Promise<CommonTypes.Segment[]> {
    return Promise.all(
      segments.map(async (segment) => {
        const file = segment.data.file;
        if (!isMediaSegmentType(segment.type) || typeof file !== "string") return segment;
        const resourceUri = normalizeAgentResourceUri(file);
        if (resourceUri) {
          if (!this.uploads) throw new Error("The workspace upload resolver is unavailable.");
          const upload = await this.uploads.resolve(resourceUri);
          if (!upload) throw new Error("The channel attachment does not exist in this workspace.");
          const { name, mime, size } = upload.manifest;
          return {
            ...segment,
            data: { ...segment.data, file: resourceUri, url: resourceUri, name, content_type: mime, size },
          };
        }
        const dataUri = /^data:([^;,]+);base64,([\s\S]+)$/u.exec(file);
        if (!file.startsWith("base64://") && !dataUri) return segment;
        const data = dataUri ? dataUri[2]! : file.slice("base64://".length);
        const bytes = decodeBase64Attachment(data, AgentChannelOutboundMediaDefaults.maxInlineBytes);
        const mime = (await fileTypeFromBuffer(bytes))?.mime ?? dataUri?.[1];
        const url = await this.save(bytes, mime);
        return { type: segment.type, data: { ...segment.data, file: url, url, size: bytes.byteLength } };
      }),
    );
  }

  async exportMedia(media: readonly AgentChannelMedia[]): Promise<AgentChannelMedia[]> {
    return Promise.all(media.map((item) => this.exportItem(item)));
  }

  async exportItem(item: AgentChannelMedia): Promise<AgentChannelMedia> {
    if (item.url) return item;
    if (item.path) {
      await mkdir(this.directory, { recursive: true });
      const target = this.target(item.contentType);
      await copyFile(item.path, target.path);
      return { ...item, url: target.url };
    }
    if (item.data) {
      const match = /^data:([^;,]+);base64,([\s\S]+)$/u.exec(item.data);
      const bytes = decodeBase64Attachment(match?.[2] ?? item.data, AgentChannelOutboundMediaDefaults.maxInlineBytes);
      const mime = (await fileTypeFromBuffer(bytes))?.mime ?? match?.[1] ?? item.contentType;
      return { ...item, url: await this.save(bytes, mime) };
    }
    throw new Error("OneBot media requires a resolved resource, URL, or binary payload.");
  }

  /** Persist owned media independently of the host URL and workspace route. */
  storeSegments(segments: readonly CommonTypes.Segment[]): CommonTypes.Segment[] {
    return this.mapOwnedMedia(segments, (name) => `/${name}`);
  }

  clientSegments(segments: readonly CommonTypes.Segment[]): CommonTypes.Segment[] {
    return this.mapOwnedMedia(segments, (name) => `${this.origin}/${name}`);
  }

  async resolveAttachments(attachments: readonly AgentChannelAttachment[]): Promise<AgentChannelAttachment[]> {
    return Promise.all(
      attachments.map(async (attachment) => {
        const name = this.ownedName(attachment.url);
        if (!name) return attachment;
        const target = path.join(this.directory, name);
        const info = await stat(target);
        if (!info.isFile() || info.size > AgentChannelOutboundMediaDefaults.maxInlineBytes) {
          throw new Error("The local OneBot attachment is not a readable media file within the upload limit.");
        }
        const bytes = await readFile(target);
        return {
          ...attachment,
          url: undefined,
          inlineData: { encoding: "base64" as const, data: bytes.toString("base64") },
        };
      }),
    );
  }

  private mapOwnedMedia(
    segments: readonly CommonTypes.Segment[],
    address: (name: string) => string,
  ): CommonTypes.Segment[] {
    return segments.map((segment) => {
      if (!isMediaSegmentType(segment.type)) return segment;
      const data = { ...segment.data };
      for (const field of ["file", "url"] as const) {
        const name = this.ownedName(data[field]);
        if (name) data[field] = address(name);
      }
      return { ...segment, data };
    });
  }

  private ownedName(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const prefix = `${this.origin}/`;
    const name = value.startsWith(prefix)
      ? value.slice(prefix.length)
      : value.startsWith("/")
        ? value.slice(1)
        : undefined;
    return name && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\.[a-z0-9]+$/u.test(name) ? name : undefined;
  }

  private async save(bytes: Buffer, mime?: string): Promise<string> {
    const target = this.target(mime);
    await writeFileAtomic(target.path, bytes, { mode: 0o600, directoryMode: 0o700 });
    return target.url;
  }

  private target(mime?: string): { path: string; url: string } {
    // Transport keeps the native type; the shared HTTP resource policy owns
    // document isolation and download behavior, independently of storage names.
    const suffix = mime ? extension(mime) : undefined;
    const name = `${randomUUID()}.${suffix || "bin"}`;
    return { path: path.join(this.directory, name), url: `${this.origin}/${name}` };
  }
}
