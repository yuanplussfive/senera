import { readHostCapabilities } from "./host";

export interface DownloadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: { loaded: number; total?: number }) => void;
}

export async function downloadUrl(
  source: string,
  fileName: string,
  options: DownloadOptions = {},
): Promise<"completed" | "delegated"> {
  options.signal?.throwIfAborted();
  const url = new URL(source, window.location.href);
  if (!["http:", "https:", "blob:", "data:"].includes(url.protocol) || url.username || url.password)
    throw new TypeError("Unsupported download address.");
  const host = readHostCapabilities();
  if (host && ["http:", "https:"].includes(url.protocol)) {
    await host.download(url.href, fileName);
    return "delegated";
  }
  const response = await fetch(url.href, {
    credentials: "include",
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) throw new Error(`Download failed with status ${response.status}.`);
  if (!options.onProgress) {
    await downloadBlob(await response.blob(), fileName);
    return "completed";
  }
  const total = Number(response.headers.get("Content-Length")) || undefined;
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let loaded = 0;
  const reader = response.body?.getReader();
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.byteLength;
        options.onProgress?.({ loaded, total });
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
  } else {
    chunks.push(new Uint8Array(await response.arrayBuffer()));
  }
  await downloadBlob(new Blob(chunks, { type: response.headers.get("Content-Type") ?? "" }), fileName);
  return "completed";
}

export async function downloadBlob(blob: Blob, fileName: string): Promise<void> {
  const host = readHostCapabilities();
  if (host) return host.saveFile(blob, fileName);
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}
