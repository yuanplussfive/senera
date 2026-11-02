import path from "node:path";

/**
 * "Open with the default application" for a rendered resource.
 *
 * The renderer fetches the bytes from a URL it already holds an authenticated
 * session for and hands them to the main process, which only stages them in the
 * desktop temp directory before asking the shell to open the path. Main therefore
 * never performs network I/O on behalf of the renderer, and no workspace path has
 * to be exposed to the page.
 */
export const DesktopExternalOpenMaxBytes = 64 * 1024 * 1024;

export type DesktopExternalOpenCode = "blocked" | "invalid-payload" | "write-failed" | "open-failed";

export interface DesktopExternalOpenResult {
  readonly ok: boolean;
  readonly code?: DesktopExternalOpenCode;
}

export interface DesktopExternalOpenRequest {
  readonly name: string;
  readonly bytes: Uint8Array;
}

export interface DesktopExternalOpenDependencies {
  readonly tempRoot: string;
  readonly writeFile: (filePath: string, bytes: Uint8Array) => Promise<void>;
  /** `shell.openPath`: resolves to an empty string on success, otherwise the failure message. */
  readonly openPath: (filePath: string) => Promise<string>;
}

const WindowsReservedNamePattern = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const UnsafeNameCharacterPattern = /[<>:"/\\|?*]/gu;
const MaxStemLength = 100;
const MaxExtensionLength = 16;

/** Reads the renderer payload, rejecting anything that is not a small non-empty byte payload. */
export function readDesktopExternalOpenRequest(payload: unknown): DesktopExternalOpenRequest | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const candidate = payload as { name?: unknown; bytes?: unknown };
  if (typeof candidate.name !== "string" || candidate.name.trim().length === 0) return undefined;
  if (!(candidate.bytes instanceof Uint8Array)) return undefined;
  if (candidate.bytes.byteLength === 0 || candidate.bytes.byteLength > DesktopExternalOpenMaxBytes) return undefined;
  return { name: candidate.name, bytes: candidate.bytes };
}

/**
 * Reduces a resource name to one safe file name. The staged file is rewritten on
 * every open, so the path stays stable instead of accumulating temp copies.
 */
export function sanitizeDesktopExternalOpenName(name: string): string {
  const base = [...path.basename(name.replace(/\\/gu, "/"))]
    .filter((character) => (character.codePointAt(0) ?? 0) > 0x1f)
    .join("");
  const cleaned = base
    .replace(UnsafeNameCharacterPattern, "_")
    .replace(/^[.\s]+/u, "")
    .replace(/[.\s]+$/u, "");
  if (cleaned.length === 0) return "resource";
  const extension = path.extname(cleaned);
  const stem = cleaned.slice(0, cleaned.length - extension.length).slice(0, MaxStemLength) || "resource";
  const boundedExtension = extension.slice(0, MaxExtensionLength);
  const candidate = `${stem}${boundedExtension}`;
  return WindowsReservedNamePattern.test(candidate) ? `_${candidate}` : candidate;
}

export function resolveDesktopExternalOpenPath(tempRoot: string, name: string): string {
  return path.join(tempRoot, sanitizeDesktopExternalOpenName(name));
}

export async function openDesktopExternalFile(
  request: DesktopExternalOpenRequest,
  dependencies: DesktopExternalOpenDependencies,
): Promise<DesktopExternalOpenResult> {
  const filePath = resolveDesktopExternalOpenPath(dependencies.tempRoot, request.name);
  try {
    await dependencies.writeFile(filePath, request.bytes);
  } catch {
    return { ok: false, code: "write-failed" };
  }
  try {
    const failure = await dependencies.openPath(filePath);
    if (failure) return { ok: false, code: "open-failed" };
  } catch {
    return { ok: false, code: "open-failed" };
  }
  return { ok: true };
}
