import { buildResourceContentUrl } from "../../api/uploadClient";
import { buildWorkspaceResourceUrl, readWorkspaceResource } from "../../api/workspaceResourceClient";
import { frontendMessage } from "../../i18n/frontendMessageCatalog";
import type { FilePreviewDescriptor } from "../../lib/filePreview";
import { LruCache } from "../../lib/LruCache";
import { preloadPierreFilePreview, preloadPierrePatchPreview } from "../../shared/code/PierreCodeView";
import type { WorkspaceResourceController } from "../../shared/workspace/WorkspaceResourceProvider";
import type { ToolResource, ToolWorkspaceChange } from "./toolResourceProjection";

const WorkspacePreviewTextLimit = 24_000;
const WorkspacePatchTextCache = new LruCache<string, string>(24);
const WorkspacePreviewCache = new LruCache<string, Promise<WorkspacePreviewState>>(24);

export type WorkspacePreviewState =
  | { readonly status: "idle" | "loading" | "unavailable" }
  | { readonly status: "error"; readonly message: string }
  | {
      readonly status: "ready";
      readonly kind: "diff" | "text";
      readonly text: string;
      readonly truncated: boolean;
      readonly prerenderedHTML: string;
    }
  | { readonly status: "ready"; readonly kind: "image"; readonly source: string; readonly truncated: false };

type WorkspacePreviewKind = "text" | "image";

async function loadWorkspacePreview(input: {
  readonly change: ToolWorkspaceChange;
  readonly controller: WorkspaceResourceController;
  readonly patchResources: readonly ToolResource[];
  readonly previewKind: WorkspacePreviewKind | undefined;
}): Promise<WorkspacePreviewSource> {
  if (!input.previewKind) return { status: "unavailable" };
  if (input.previewKind === "image") {
    if (input.change.workspaceStatus === "deleted") return { status: "unavailable" };
    return {
      status: "ready",
      kind: "image",
      source: buildWorkspaceResourceUrl(input.controller.httpBaseUrl, input.change.key, true),
      truncated: false,
    };
  }
  const patch = await readPatchPreview(input);
  if (patch) return { status: "ready", kind: "diff", ...boundPreviewText(patch) };
  if (input.change.workspaceStatus === "deleted") return { status: "unavailable" };

  const resource = await readWorkspaceResource(input.controller.httpBaseUrl, input.change.key);
  if (resource.content === undefined) return { status: "unavailable" };
  return { status: "ready", kind: "text", ...boundPreviewText(resource.content) };
}

type WorkspacePreviewSource =
  | { readonly status: "unavailable" }
  | { readonly status: "ready"; readonly kind: "diff" | "text"; readonly text: string; readonly truncated: boolean }
  | { readonly status: "ready"; readonly kind: "image"; readonly source: string; readonly truncated: false };

export function readWorkspacePreview(input: {
  readonly change: ToolWorkspaceChange;
  readonly controller: WorkspaceResourceController;
  readonly patchResources: readonly ToolResource[];
  readonly previewKind: WorkspacePreviewKind;
  readonly theme: "light" | "dark";
}): Promise<WorkspacePreviewState> {
  const cacheKey = createWorkspacePreviewIdentity(input);
  const cached = WorkspacePreviewCache.get(cacheKey);
  if (cached) return cached;

  const pending = loadWorkspacePreview(input)
    .then((source) => materializeWorkspacePreview(source, input.change.key, input.theme))
    .catch(
      (error: unknown) =>
        ({
          status: "error",
          message: error instanceof Error ? error.message : frontendMessage("workflow.workspace.previewFailed"),
        }) satisfies WorkspacePreviewState,
    );
  WorkspacePreviewCache.set(cacheKey, pending);
  void pending.then((state) => {
    if (state.status === "error") WorkspacePreviewCache.delete(cacheKey);
  });
  return pending;
}

async function materializeWorkspacePreview(
  source: WorkspacePreviewSource,
  fileName: string,
  theme: "light" | "dark",
): Promise<WorkspacePreviewState> {
  if (source.status !== "ready") return source;
  if (source.kind === "image") {
    await decodeWorkspacePreviewImage(source.source);
    return source;
  }
  const prerenderedHTML =
    source.kind === "diff"
      ? await preloadPierrePatchPreview({ patch: source.text, theme })
      : await preloadPierreFilePreview({
          code: source.text,
          fileName,
          lineNumbers: false,
          theme,
          wrapped: false,
        });
  return { ...source, prerenderedHTML };
}

function decodeWorkspacePreviewImage(source: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      void image.decode().then(resolve, reject);
    };
    image.onerror = reject;
    image.src = source;
  });
}

export function createWorkspacePreviewIdentity(input: {
  readonly change: ToolWorkspaceChange;
  readonly controller: WorkspaceResourceController | undefined;
  readonly patchResources: readonly ToolResource[];
  readonly previewKind: WorkspacePreviewKind | undefined;
  readonly theme: "light" | "dark";
}): string {
  return JSON.stringify({
    endpoint: input.controller?.httpBaseUrl,
    path: input.change.key,
    status: input.change.workspaceStatus ?? input.change.status,
    previewKind: input.previewKind,
    patchSources: input.patchResources.map((resource) => resource.uri),
    theme: input.theme,
  });
}

export function workspacePreviewKind(preview: FilePreviewDescriptor | undefined): WorkspacePreviewKind | undefined {
  if (preview?.renderKind === "image") return "image";
  return preview?.contentKind === "text" ? "text" : undefined;
}

async function readPatchPreview(input: {
  readonly change: ToolWorkspaceChange;
  readonly controller: WorkspaceResourceController;
  readonly patchResources: readonly ToolResource[];
}): Promise<string | undefined> {
  const sources = input.patchResources.map((resource) => {
    const source = buildResourceContentUrl(input.controller.httpBaseUrl, resource.uri);
    if (!source) throw new Error(frontendMessage("resource.invalidReference"));
    return source;
  });
  const responses = await Promise.allSettled(
    sources.map(async (source) => {
      const text = await readWorkspacePatchText(source);
      return text ? selectFilePatch(text, input.change.key) : undefined;
    }),
  );
  for (const response of [...responses].reverse()) {
    if (response.status === "fulfilled" && response.value) return response.value;
  }
  const failed = responses.find((response) => response.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  return undefined;
}

async function readWorkspacePatchText(source: string): Promise<string | undefined> {
  const cached = WorkspacePatchTextCache.get(source);
  if (cached !== undefined) return cached;
  const response = await fetch(source, { credentials: "include" });
  if (!response.ok) throw new Error(frontendMessage("resource.httpFailed", { status: response.status }));
  const text = await response.text();
  WorkspacePatchTextCache.set(source, text);
  return text;
}

function boundPreviewText(text: string): { readonly text: string; readonly truncated: boolean } {
  const normalized = text.replace(/\r\n?/gu, "\n");
  return normalized.length > WorkspacePreviewTextLimit
    ? { text: `${normalized.slice(0, WorkspacePreviewTextLimit)}\n…`, truncated: true }
    : { text: normalized, truncated: false };
}

function selectFilePatch(patch: string, filePath: string): string | undefined {
  const lines = patch.replace(/\r\n?/gu, "\n").split("\n");
  const headerStarts = lines.flatMap((_, index) => (isPatchHeader(lines, index) ? [index] : []));
  const target = normalizePatchPath(filePath);
  for (const [index, start] of headerStarts.entries()) {
    const nextStart = headerStarts[index + 1] ?? lines.length;
    const block = lines.slice(start, nextStart);
    if (readPatchHeaderPaths(block).some((path) => patchPathMatches(path, target))) return block.join("\n");
  }
  return headerStarts.length === 0 && patch.trim().length > 0 ? patch : undefined;
}

function isPatchHeader(lines: readonly string[], index: number): boolean {
  const line = lines[index] ?? "";
  const next = lines[index + 1] ?? "";
  return line.startsWith("--- ") && next.startsWith("+++ ");
}

function readPatchHeaderPaths(lines: readonly string[]): readonly string[] {
  const hunkStart = lines.findIndex((line) => line.startsWith("@@ "));
  return lines
    .slice(0, hunkStart >= 0 ? hunkStart : 4)
    .flatMap((line) => (line.startsWith("--- ") || line.startsWith("+++ ") ? [normalizePatchPath(line.slice(4))] : []));
}

function patchPathMatches(candidate: string, target: string): boolean {
  return candidate === target || candidate.startsWith(`${target} `) || candidate.startsWith(`${target}\t`);
}

function normalizePatchPath(value: string): string {
  return value
    .trim()
    .replace(/^['"]|['"]$/gu, "")
    .replace(/^(?:a|b)\//u, "")
    .replace(/\\/gu, "/");
}
