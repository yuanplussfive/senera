import {
  File,
  FileArchive,
  FileAudio,
  FileChartColumn,
  FileCode2,
  FileImage,
  FileJson2,
  FileSpreadsheet,
  FileText,
  FileType2,
  FileVideo,
  type LucideIcon,
} from "lucide-react";
import { frontendMessage } from "../i18n/frontendMessageCatalog";

export interface FilePreviewInput {
  name: string;
  mime?: string;
}

export interface FilePreviewDescriptor {
  id: string;
  label: string;
  Icon: LucideIcon;
  iconClassName: string;
  badgeClassName: string;
}

interface FilePreviewProfile extends FilePreviewDescriptor {
  names?: readonly string[];
  extensions?: readonly string[];
  mimes?: readonly string[];
  mimePrefixes?: readonly string[];
}

const DefaultFilePreview: FilePreviewDescriptor = {
  id: "file",
  label: frontendMessage("file.type.file"),
  Icon: File,
  iconClassName: "text-ink-500",
  badgeClassName: "border-ink-200 bg-paper-100 text-ink-500",
};

const FilePreviewProfiles: readonly FilePreviewProfile[] = [
  {
    id: "pdf",
    label: "PDF",
    Icon: FileText,
    iconClassName: "text-ink-600",
    badgeClassName: "border-ink-200 bg-paper-100 text-ink-650",
    extensions: [".pdf"],
    mimes: ["application/pdf"],
  },
  {
    id: "word",
    label: frontendMessage("file.type.document"),
    Icon: FileType2,
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
    Icon: FileSpreadsheet,
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
    Icon: FileChartColumn,
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
    Icon: FileJson2,
    iconClassName: "text-ink-600",
    badgeClassName: "border-ink-200 bg-paper-100 text-ink-650",
    extensions: [".json", ".jsonl", ".ipynb"],
    mimes: ["application/json", "application/x-ndjson"],
  },
  {
    id: "code",
    label: frontendMessage("file.type.code"),
    Icon: FileCode2,
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
    id: "text",
    label: frontendMessage("file.type.text"),
    Icon: FileText,
    iconClassName: "text-ink-600",
    badgeClassName: "border-ink-200 bg-paper-50 text-ink-650",
    extensions: [".log", ".md", ".markdown", ".txt"],
    mimePrefixes: ["text/"],
  },
  {
    id: "image",
    label: frontendMessage("file.type.image"),
    Icon: FileImage,
    iconClassName: "text-ink-600",
    badgeClassName: "border-ink-200 bg-paper-100 text-ink-650",
    extensions: [".avif", ".gif", ".heic", ".jpeg", ".jpg", ".png", ".svg", ".webp"],
    mimePrefixes: ["image/"],
  },
  {
    id: "audio",
    label: frontendMessage("file.type.audio"),
    Icon: FileAudio,
    iconClassName: "text-ink-600",
    badgeClassName: "border-ink-200 bg-paper-100 text-ink-650",
    extensions: [".aac", ".flac", ".m4a", ".mp3", ".ogg", ".wav"],
    mimePrefixes: ["audio/"],
  },
  {
    id: "video",
    label: frontendMessage("file.type.video"),
    Icon: FileVideo,
    iconClassName: "text-ink-600",
    badgeClassName: "border-ink-200 bg-paper-100 text-ink-650",
    extensions: [".avi", ".m4v", ".mkv", ".mov", ".mp4", ".webm"],
    mimePrefixes: ["video/"],
  },
  {
    id: "archive",
    label: frontendMessage("file.type.archive"),
    Icon: FileArchive,
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
    (mime
      ? FilePreviewProfiles.find((profile) => profile.mimePrefixes?.some((prefix) => mime.startsWith(prefix)))
      : undefined) ??
    (extension ? ProfilesByExtension.get(extension) : undefined) ??
    DefaultFilePreview
  );
}

export function isImageFilePreview(input: FilePreviewInput): boolean {
  return resolveFilePreview(input).id === "image";
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
