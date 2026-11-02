export type SeneraSocketEvent =
  | { type: "open" }
  | { type: "message"; data: string }
  | { type: "close"; code: number; reason: string; wasClean: boolean }
  | { type: "error"; message: string };

export interface SeneraSocketPort {
  send(data: string): Promise<void>;
  close(code: number, reason: string): Promise<void>;
}

/** Capabilities exposed only to a paired, first-party document. No UI framework dependency. */
export interface SeneraHostCapabilities {
  openExternal(url: string): Promise<void>;
  download(url: string, fileName: string): Promise<void>;
  saveFile(blob: Blob, fileName: string): Promise<void>;
  openConnections(): Promise<void>;
  openBackgroundSettings?(): Promise<void>;
  openWebClient(url: string): Promise<{ ok: boolean }>;
  connectSocket?(url: string, receive: (event: SeneraSocketEvent) => void): SeneraSocketPort;
}

export function readHostCapabilities(): SeneraHostCapabilities | undefined {
  return (window as Window & { __SENERA_MOBILE__?: SeneraHostCapabilities }).__SENERA_MOBILE__;
}

export async function openExternalLink(source: string): Promise<void> {
  const url = new URL(source, window.location.href);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password)
    throw new TypeError("Unsupported external link.");
  const host = readHostCapabilities();
  if (host) return host.openExternal(url.href);
  // noopener intentionally returns null in several browsers; it is not a failure acknowledgement.
  window.open(url.href, "_blank", "noopener,noreferrer");
}
