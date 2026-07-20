import { pathToFileURL } from "node:url";
import type { DesktopFrontendSource } from "./DesktopFrontendSource.js";

export function resolveExternalHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function isTrustedDesktopNavigation(value: string, source: DesktopFrontendSource): boolean {
  try {
    const target = new URL(value);
    if (source.kind === "url") {
      return target.origin === new URL(source.url).origin;
    }

    const allowed = pathToFileURL(source.filePath);
    target.search = "";
    target.hash = "";
    return normalizeFileUrl(target) === normalizeFileUrl(allowed);
  } catch {
    return false;
  }
}

function normalizeFileUrl(url: URL): string {
  const value = url.toString();
  return process.platform === "win32" ? value.toLocaleLowerCase("en-US") : value;
}
