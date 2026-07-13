import type { BrowserWindow } from "electron";

export type DesktopFrontendSource =
  | {
      kind: "file";
      filePath: string;
    }
  | {
      kind: "url";
      url: string;
    };

export function createDesktopFrontendSource({
  devServerUrl,
  frontendIndexHtml,
}: {
  devServerUrl: string | undefined;
  frontendIndexHtml: string;
}): DesktopFrontendSource {
  const trimmedUrl = devServerUrl?.trim();
  if (!trimmedUrl) {
    return {
      kind: "file",
      filePath: frontendIndexHtml,
    };
  }

  const url = new URL(trimmedUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("SENERA_DESKTOP_FRONTEND_URL must use http or https.");
  }

  return {
    kind: "url",
    url: url.toString(),
  };
}

export function resolveDesktopFrontendUrl({
  source,
  query = {},
}: {
  source: Extract<DesktopFrontendSource, { kind: "url" }>;
  query?: Record<string, string | undefined>;
}): string {
  const url = new URL(source.url);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

export async function loadDesktopFrontend(
  window: BrowserWindow,
  source: DesktopFrontendSource,
  query?: Record<string, string | undefined>,
): Promise<void> {
  if (source.kind === "url") {
    await window.loadURL(resolveDesktopFrontendUrl({ source, query }));
    return;
  }

  const fileQuery = compactQuery(query);
  await window.loadFile(source.filePath, fileQuery ? { query: fileQuery } : undefined);
}

function compactQuery(query: Record<string, string | undefined> | undefined): Record<string, string> | undefined {
  if (!query) return undefined;
  const entries = Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
