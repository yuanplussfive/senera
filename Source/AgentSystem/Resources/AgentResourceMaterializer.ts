import crypto from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import { extension as mimeExtension } from "mime-types";
import { throwIfAborted } from "../Core/AgentCancellation.js";
import { isAgentBase64 } from "../Core/AgentBase64.js";
import { isAgentUnknownRecord } from "../Core/AgentUnknownValue.js";
import { createAgentUploadId } from "../Uploads/AgentUploadLocator.js";
import type { AgentPublishedResource, AgentResourcePublisher } from "./AgentResourcePublisher.js";

export interface AgentResourceMaterializationOptions {
  readonly signal?: AbortSignal;
}

export interface AgentResourceMaterializationResult<TValue> {
  readonly value: TValue;
  readonly changed: boolean;
  readonly resources: readonly AgentPublishedResource[];
}

interface DataUrlPayload {
  readonly start: number;
  readonly end: number;
  readonly mime: string;
  readonly base64: string;
}

/**
 * Converts provider-owned binary payloads into host-owned resources.
 *
 * The materializer deliberately understands only transport-level encodings:
 * self-describing data URLs and fields explicitly declared by a tool package.
 * It never infers media from a provider-specific field name or from a bare
 * Base64-looking string.
 */
export class AgentResourceMaterializer {
  private readonly cache = new Map<string, Promise<AgentPublishedResource>>();

  constructor(private readonly publisher: AgentResourcePublisher) {}

  async materializeText(
    value: string,
    options: AgentResourceMaterializationOptions = {},
  ): Promise<AgentResourceMaterializationResult<string>> {
    const payloads = findDataUrlPayloads(value);
    if (payloads.length === 0) {
      const embedded = await this.detectEmbeddedMedia(value, options.signal);
      return embedded
        ? { value: embedded.resource.resourceUri, changed: true, resources: [embedded.resource] }
        : { value, changed: false, resources: [] };
    }

    const resources: AgentPublishedResource[] = [];
    let cursor = 0;
    let projected = "";
    for (const payload of payloads) {
      throwIfAborted(options.signal);
      const resource = await this.materializeBase64(payload.base64, payload.mime, undefined, options.signal);
      resources.push(resource);
      projected += value.slice(cursor, payload.start);
      projected += resource.resourceUri;
      cursor = payload.end;
    }
    return {
      value: projected + value.slice(cursor),
      changed: true,
      resources,
    };
  }

  async materializeValue(
    value: unknown,
    options: AgentResourceMaterializationOptions = {},
  ): Promise<AgentResourceMaterializationResult<unknown>> {
    return this.materializeDataUrls(value, options, new WeakSet<object>());
  }

  private async materializeDataUrls(
    value: unknown,
    options: AgentResourceMaterializationOptions,
    ancestors: WeakSet<object>,
  ): Promise<AgentResourceMaterializationResult<unknown>> {
    if (typeof value === "string") return this.materializeText(value, options);
    if (value === null || typeof value !== "object") return { value, changed: false, resources: [] };
    if (ancestors.has(value)) return { value, changed: false, resources: [] };

    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        const entries: unknown[] = [];
        const resources: AgentPublishedResource[] = [];
        let changed = false;
        for (const entry of value) {
          const result = await this.materializeDataUrls(entry, options, ancestors);
          entries.push(result.value);
          changed ||= result.changed;
          resources.push(...result.resources);
        }
        return { value: changed ? entries : value, changed, resources };
      }
      if (!isAgentUnknownRecord(value)) return { value, changed: false, resources: [] };

      const record: Record<string, unknown> = {};
      const resources: AgentPublishedResource[] = [];
      let changed = false;
      for (const [key, entry] of Object.entries(value)) {
        const result = await this.materializeDataUrls(entry, options, ancestors);
        record[key] = result.value;
        changed ||= result.changed;
        resources.push(...result.resources);
      }
      return { value: changed ? record : value, changed, resources };
    } finally {
      ancestors.delete(value);
    }
  }

  private async detectEmbeddedMedia(
    value: string,
    signal: AbortSignal | undefined,
  ): Promise<{ resource: AgentPublishedResource } | undefined> {
    const candidate = value.trim();
    if (candidate.length < 64 || !isAgentBase64(candidate)) return undefined;
    const sampleCharacters = Math.min(candidate.length, Math.ceil((4_100 * 4) / 3));
    const sample = Buffer.from(candidate.slice(0, sampleCharacters), "base64");
    const detected = await fileTypeFromBuffer(sample);
    if (!detected) return undefined;
    const resource = await this.materializeBase64(candidate, detected.mime, undefined, signal);
    return { resource };
  }

  async materializeBase64(
    base64: string,
    mime: string,
    name: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<AgentPublishedResource> {
    throwIfAborted(signal);
    const normalizedMime = mime.trim();
    const key = `${normalizedMime}\u0000${crypto.createHash("sha256").update(base64).digest("hex")}`;
    const existing = this.cache.get(key);
    if (existing) return existing;

    const operation = this.publishBase64Payload(base64, normalizedMime, name, signal);
    this.cache.set(key, operation);
    try {
      return await operation;
    } catch (error) {
      this.cache.delete(key);
      throw error;
    }
  }

  private publishBase64Payload(
    base64: string,
    mime: string,
    name: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<AgentPublishedResource> {
    const input = {
      base64,
      name: name?.trim() || resourceFileName(mime),
      mime,
      signal,
    };
    if (this.publisher.publishBase64) return this.publisher.publishBase64(input);
    return this.publisher.publishBytes({
      bytes: Buffer.from(base64, "base64"),
      name: input.name,
      mime,
      signal,
    });
  }
}

function findDataUrlPayloads(value: string): readonly DataUrlPayload[] {
  const payloads: DataUrlPayload[] = [];
  let searchStart = 0;
  while (searchStart < value.length) {
    const start = value.indexOf("data:", searchStart);
    if (start < 0) break;
    const headerEnd = value.indexOf(",", start + 5);
    if (headerEnd < 0) break;
    const header = value.slice(start + 5, headerEnd);
    const [mime, ...parameters] = header.split(";");
    if (!mime || !mime.includes("/") || !parameters.some((parameter) => parameter.toLowerCase() === "base64")) {
      searchStart = headerEnd + 1;
      continue;
    }
    let end = headerEnd + 1;
    while (end < value.length && isBase64DataCharacter(value[end]!)) end += 1;
    const base64 = value.slice(headerEnd + 1, end);
    if (!isAgentBase64(base64)) {
      searchStart = headerEnd + 1;
      continue;
    }
    payloads.push({ start, end, mime, base64 });
    searchStart = end;
  }
  return payloads;
}

function isBase64DataCharacter(value: string): boolean {
  const code = value.charCodeAt(0);
  return (
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0x30 && code <= 0x39) ||
    code === 0x2b ||
    code === 0x2f ||
    code === 0x3d
  );
}

function resourceFileName(mime: string): string {
  const extension = mimeExtension(mime) || mime.split("/", 2)[1]?.replace(/[^a-z0-9]+/giu, "") || "bin";
  return `${createAgentUploadId()}.${extension}`;
}
