import { Readable } from "node:stream";
import type { AgentChannelAttachment } from "./AgentChannelTypes.js";
import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";
import type { AgentUploadStore } from "../Uploads/AgentUploadStore.js";
import { assertSafeWebUrl } from "../Web/AgentWebUrlPolicy.js";
import { isAgentWebRedirect, projectAgentWebRedirectHeaders } from "../Web/AgentWebRedirectPolicy.js";

const AttachmentDownloadTimeoutMs = 45_000;
const MaximumAttachmentRedirects = 3;

export interface AgentChannelAttachmentStore {
  readonly maxFileBytes: number;
  readonly resolve?: AgentUploadStore["resolve"];
  save(input: { stream: Readable; originalName: string; declaredMime?: string }): Promise<AgentUploadAttachment>;
}

/** Downloads a channel attachment into the durable upload store after URL and size checks. */
export async function ingestAgentChannelAttachment(
  store: AgentChannelAttachmentStore,
  attachment: AgentChannelAttachment,
  requestHeaders?: Readonly<Record<string, string>>,
): Promise<AgentUploadAttachment | undefined> {
  if (attachment.resourceUri) {
    if (!store.resolve) throw new Error("The workspace upload resolver is unavailable.");
    const upload = await store.resolve(attachment.resourceUri);
    if (!upload) throw new Error("The channel attachment does not exist in this workspace.");
    const { resourceUri, name, mime, size, sha256 } = upload.manifest;
    return { resourceUri, name, mime, size, sha256, status: "uploaded" };
  }
  if (attachment.inlineData) {
    const bytes = decodeBase64Attachment(attachment.inlineData.data, store.maxFileBytes);
    return store.save({
      stream: Readable.from(bytes),
      originalName: attachment.filename?.trim() || "channel-attachment",
      declaredMime: attachment.contentType,
    });
  }

  const rawUrl = attachment.url?.trim().replace(/^\/\//u, "https://");
  if (!rawUrl) return undefined;
  let url: URL;
  try {
    url = await assertSafeWebUrl(rawUrl, {
      maxUrlLength: 8_192,
      allowPrivateNetworks: false,
      allowSyntheticProxyAddresses: true,
    });
  } catch {
    return undefined;
  }

  let response: Response | undefined;
  let headers = requestHeaders;
  const signal = AbortSignal.timeout(AttachmentDownloadTimeoutMs);
  for (let redirectCount = 0; redirectCount <= MaximumAttachmentRedirects; redirectCount += 1) {
    response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers,
      signal,
    });
    if (!isAgentWebRedirect(response.status)) break;
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (!location) throw new Error(`Attachment redirect ${response.status} has no location.`);
    if (redirectCount >= MaximumAttachmentRedirects)
      throw new Error("Attachment download exceeded its redirect limit.");
    const target = await assertSafeWebUrl(new URL(location, url), {
      maxUrlLength: 8_192,
      allowPrivateNetworks: false,
      allowSyntheticProxyAddresses: true,
    });
    headers = projectAgentWebRedirectHeaders(headers, url, target);
    url = target;
  }
  if (!response) return undefined;
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`attachment download failed with HTTP ${response.status}`);
  }
  const declaredLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > store.maxFileBytes) {
    await response.body.cancel();
    throw new Error(`attachment exceeds the ${store.maxFileBytes} byte limit`);
  }
  const stream = Readable.fromWeb(response.body as never);
  try {
    return await store.save({
      stream,
      originalName: attachment.filename?.trim() || "channel-attachment",
      declaredMime: attachment.contentType ?? response.headers.get("content-type") ?? undefined,
    });
  } finally {
    stream.destroy();
  }
}

/**
 * Node's base64 decoder accepts malformed input by design. Channel media is a
 * security boundary, so validate the wire representation and its decoded size
 * before allocating the buffer that will be persisted in the workspace.
 */
export function decodeBase64Attachment(value: string, maximumBytes: number): Buffer {
  const normalized = value.replace(/\s/gu, "");
  if (!normalized || !isCanonicalBase64(normalized)) {
    throw new Error("channel attachment contains malformed base64 data");
  }
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  const estimatedBytes = (normalized.length / 4) * 3 - padding;
  if (estimatedBytes > maximumBytes) {
    throw new Error(`attachment exceeds the ${maximumBytes} byte limit`);
  }
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) {
    throw new Error(`attachment exceeds the ${maximumBytes} byte limit`);
  }
  return bytes;
}

function isCanonicalBase64(value: string): boolean {
  // A repeated capture/group makes V8 exhaust its regexp stack on ordinary
  // multi-megabyte files. A single character class scans with bounded stack.
  return value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/u.test(value);
}
