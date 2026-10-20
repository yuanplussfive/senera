import { frontendMessage } from "../i18n/frontendMessageCatalog";
import type { AppIconName } from "../shared/ui";

export interface FilePreviewInput {
  name: string;
  mime?: string;
}

export interface FilePreviewDescriptor {
  id: string;
  label: string;
  contentKind: "text" | "media" | "binary";
  renderKind: FilePreviewRenderKind;
  icon: AppIconName;
  iconClassName: string;
  badgeClassName: string;
}

export type FilePreviewRenderKind = "text" | "diff" | "image" | "audio" | "video" | "pdf" | "file";

interface FilePreviewProfile extends FilePreviewDescriptor {
  names?: readonly string[];
  extensions?: readonly string[];
  mimes?: readonly string[];
  mimePrefixes?: readonly string[];
}

const DefaultFilePreview: FilePreviewDescriptor = {
  id: "file",
  label: frontendMessage("file.type.file"),
  contentKind: "binary",
  renderKind: "file",
  icon: "file-text",
  iconClassName: "text-ink-500",
  badgeClassName: "border-ink-200 bg-paper-100 text-ink-500",
};

const FilePreviewProfiles: readonly FilePreviewProfile[] = [
  {
    id: "pdf",
    label: "PDF",
    contentKind: "binary",
    renderKind: "pdf",
    icon: "file-text",
    iconClassName: "text-ink-600",
    badgeClassName: "border-ink-200 bg-paper-100 text-ink-650",
    extensions: [".pdf"],
    mimes: ["application/pdf"],
  },
  {
    id: "word",
    label: frontendMessage("file.type.document"),
    contentKind: "binary",
    renderKind: "file",
    icon: "file-text",
    iconClassName: "text-ink-600",
    badgeClassName: "border-ink-200 bg-paper-100 text-ink-650",
    extensions: [".doc", ".docx", ".docm", ".dot", ".dotx", ".odt", ".rtf"],
    mimes: [
      "application/msword",
      "application/rtf",
      "application/vnd.oasis.opendocument.text",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-word.document.macroenabled.12",
      "text/rtf",
    ],
  },
  {
    id: "spreadsheet",
    label: frontendMessage("file.type.spreadsheet"),
    contentKind: "binary",
    renderKind: "file",
    icon: "file-text",
    iconClassName: "text-ink-600",
    badgeClassName: "border-ink-200 bg-paper-100 text-ink-650",
    extensions: [".csv", ".ods", ".xls", ".xlsx", ".xlsm"],
    mimes: [
      "application/vnd.ms-excel",
      "application/vnd.oasis.opendocument.spreadsheet",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel.sheet.macroenabled.12",
      "text/csv",
    ],
  },
  {
    id: "presentation",
    label: frontendMessage("file.type.presentation"),
    contentKind: "binary",
    renderKind: "file",
    icon: "file-text",
    iconClassName: "text-ink-600",
    badgeClassName: "border-ink-200 bg-paper-100 text-ink-650",
    extensions: [".odp", ".ppt", ".pptx", ".pptm"],
    mimes: [
      "application/vnd.ms-powerpoint",
      "application/vnd.oasis.opendocument.presentation",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.ms-powerpoint.presentation.macroenabled.12",
    ],
  },
  {
    id: "json",
    label: "JSON",
    contentKind: "text",
    renderKind: "text",
    icon: "file-json",
    iconClassName: "text-ink-600",
    badgeClassName: "border-ink-200 bg-paper-100 text-ink-650",
    extensions: [".json", ".jsonl", ".ipynb"],
    mimes: ["application/json", "application/ld+json", "application/x-ndjson"],
  },
  {
    id: "code",
    label: frontendMessage("file.type.code"),
    contentKind: "text",
    renderKind: "text",
    icon: "file-code",
    iconClassName: "text-ink-600",
    badgeClassName: "border-ink-200 bg-paper-100 text-ink-650",
    names: ["dockerfile", "makefile", "go.mod", "go.sum", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"],
    extensions: [
      ".astro",
      ".c",
      ".cc",
      ".clj",
      ".cpp",
      ".cs",
      ".css",
      ".dart",
      ".go",
      ".h",
      ".hpp",
      ".html",
      ".java",
      ".js",
      ".jsx",
      ".kt",
      ".lua",
      ".mjs",
      ".php",
      ".ps1",
      ".py",
      ".rb",
      ".rs",
      ".scss",
      ".sh",
      ".sql",
      ".svg",
      ".svelte",
      ".swift",
      ".toml",
      ".ts",
      ".tsx",
      ".vue",
      ".xml",
      ".yaml",
      ".yml",
      ".zig",
    ],
    mimes: [
      "application/javascript",
      "application/typescript",
      "application/x-sh",
      "application/x-javascript",
      "application/xml",
      "image/svg+xml",
      "text/css",
      "text/html",
      "text/javascript",
      "text/x-go",
      "text/x-python",
      "text/xml",
      "text/yaml",
    ],
  },
  {
    id: "diff",
    label: "Diff",
    contentKind: "text",
    renderKind: "diff",
    icon: "file-code",
    iconClassName: "text-ink-600",
    badgeClassName: "border-ink-200 bg-paper-100 text-ink-650",
    extensions: [".diff", ".patch"],
    mimes: ["text/x-diff", "text/x-patch"],
  },
  {
    id: "text",
    label: frontendMessage("file.type.text"),
    contentKind: "text",
    renderKind: "text",
    icon: "file-text",
    iconClassName: "text-ink-600",
    badgeClassName: "border-ink-200 bg-paper-50 text-ink-650",
    extensions: [".log", ".md", ".markdown", ".txt"],
    mimePrefixes: ["text/"],
  },
  {
    id: "image",
    label: frontendMessage("file.type.image"),
    contentKind: "media",
    renderKind: "image",
    icon: "image",
    iconClassName: "text-ink-600",
    badgeClassName: "border-ink-200 bg-paper-100 text-ink-650",
    extensions: [".avif", ".gif", ".heic", ".jpeg", ".jpg", ".png", ".webp"],
    mimePrefixes: ["image/"],
  },
  {
    id: "audio",
    label: frontendMessage("file.type.audio"),
    contentKind: "media",
    renderKind: "audio",
    icon: "file-audio",
    iconClassName: "text-ink-600",
    badgeClassName: "border-ink-200 bg-paper-100 text-ink-650",
    extensions: [".aac", ".flac", ".m4a", ".mp3", ".ogg", ".wav"],
    mimePrefixes: ["audio/"],
  },
  {
    id: "video",
    label: frontendMessage("file.type.video"),
    contentKind: "media",
    renderKind: "video",
    icon: "file-video",
    iconClassName: "text-ink-600",
    badgeClassName: "border-ink-200 bg-paper-100 text-ink-650",
    extensions: [".avi", ".m4v", ".mkv", ".mov", ".mp4", ".webm"],
    mimePrefixes: ["video/"],
  },
  {
    id: "archive",
    label: frontendMessage("file.type.archive"),
    contentKind: "binary",
    renderKind: "file",
    icon: "archive",
    iconClassName: "text-ink-600",
    badgeClassName: "border-ink-200 bg-paper-100 text-ink-650",
    extensions: [".7z", ".br", ".bz2", ".gz", ".rar", ".tar", ".tgz", ".xz", ".zip"],
    mimes: [
      "application/gzip",
      "application/vnd.rar",
      "application/x-7z-compressed",
      "application/x-bzip2",
      "application/x-tar",
      "application/zip",
    ],
  },
];

const ProfilesByName = indexProfiles(FilePreviewProfiles, "names");
const ProfilesByExtension = indexProfiles(FilePreviewProfiles, "extensions");
const ProfilesByMime = indexProfiles(FilePreviewProfiles, "mimes");

export function resolveFilePreview(input: FilePreviewInput): FilePreviewDescriptor {
  const name = normalizeToken(input.name);
  const mime = normalizeToken(input.mime);
  const extension = readFileExtension(name);

  return (
    (name ? ProfilesByName.get(name) : undefined) ??
    (mime ? ProfilesByMime.get(mime) : undefined) ??
    (extension ? ProfilesByExtension.get(extension) : undefined) ??
    (mime
      ? FilePreviewProfiles.find((profile) => profile.mimePrefixes?.some((prefix) => mime.startsWith(prefix)))
      : undefined) ??
    DefaultFilePreview
  );
}

export function isImageFilePreview(input: FilePreviewInput): boolean {
  return resolveFilePreview(input).renderKind === "image";
}

/**
 * A workspace change can only open a line-oriented preview when its existing
 * file profile identifies it as text. Unknown and binary profiles stay as
 * ordinary resource rows instead of showing an empty preview surface.
 */
export function isTextFilePreview(input: FilePreviewInput): boolean {
  return resolveFilePreview(input).contentKind === "text";
}

function indexProfiles(
  profiles: readonly FilePreviewProfile[],
  key: "names" | "extensions" | "mimes",
): ReadonlyMap<string, FilePreviewProfile> {
  return new Map(
    profiles.flatMap((profile) => (profile[key] ?? []).map((value) => [normalizeToken(value), profile] as const)),
  );
}

function readFileExtension(name: string): string {
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index).toLowerCase() : "";
}

function normalizeToken(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}
