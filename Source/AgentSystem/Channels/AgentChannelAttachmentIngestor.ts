import { Readable } from "node:stream";
import type { AgentChannelAttachment } from "./AgentChannelTypes.js";
import type { AgentUploadAttachment } from "../Uploads/AgentUploadTypes.js";
import { assertSafeWebUrl } from "../Web/AgentWebUrlPolicy.js";

export interface AgentChannelAttachmentStore {
  readonly maxFileBytes: number;
  save(input: { stream: Readable; originalName: string; declaredMime?: string }): Promise<AgentUploadAttachment>;
}

/** Downloads a channel attachment into the durable upload store after URL and size checks. */
export async function ingestAgentChannelAttachment(
  store: AgentChannelAttachmentStore,
  attachment: AgentChannelAttachment,
  requestHeaders?: Readonly<Record<string, string>>,
): Promise<AgentUploadAttachment | undefined> {
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
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: { ...(requestHeaders ?? {}) },
      signal: AbortSignal.timeout(45_000),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (!location) break;
    url = await assertSafeWebUrl(new URL(location, url), {
      maxUrlLength: 8_192,
      allowPrivateNetworks: false,
      allowSyntheticProxyAddresses: true,
    });
  }
  if (!response) return undefined;
  if (!response.ok || !response.body) throw new Error(`attachment download failed with HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > store.maxFileBytes) {
    throw new Error(`attachment exceeds the ${store.maxFileBytes} byte limit`);
  }
  return store.save({
    stream: Readable.fromWeb(response.body as never),
    originalName: attachment.filename?.trim() || "channel-attachment",
    declaredMime: attachment.contentType ?? response.headers.get("content-type") ?? undefined,
  });
}
