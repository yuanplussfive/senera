import type { AppIconName } from "../ui/AppIcon";
import workspaceFileIconMap from "./workspaceFileIconMap.json";

const defaultFileIcon: AppIconName = "file-text";
const kindDefaults: Readonly<Record<"text" | "image" | "binary" | "directory" | "file", AppIconName>> = {
  text: defaultFileIcon,
  image: "image",
  binary: defaultFileIcon,
  directory: "folder",
  file: defaultFileIcon,
};

export function resolveWorkspaceFileIcon(
  name: string,
  kind: "text" | "image" | "binary" | "directory" | "file",
): AppIconName {
  if (kind === "directory") return kindDefaults.directory;
  const normalized = name.trim().replace(/\\/gu, "/").toLowerCase();
  const mapped = workspaceFileIconMap[normalized as keyof typeof workspaceFileIconMap];
  if (mapped) return mapped as AppIconName;
  const extension = readFileExtension(normalized);
  const extensionIcon = extension ? workspaceFileIconMap[extension as keyof typeof workspaceFileIconMap] : undefined;
  return (extensionIcon as AppIconName | undefined) ?? kindDefaults[kind];
}

function readFileExtension(name: string): string | undefined {
  const separator = name.lastIndexOf("/");
  const baseName = separator >= 0 ? name.slice(separator + 1) : name;
  const dotFileStem = readDotFileStem(baseName);
  if (dotFileStem) return dotFileStem;
  const index = baseName.lastIndexOf(".");
  return index > 0 ? baseName.slice(index) : undefined;
}

function readDotFileStem(baseName: string): string | undefined {
  if (!baseName.startsWith(".") || baseName.length < 2) return undefined;
  const separator = baseName.indexOf(".", 1);
  return separator > 1 ? baseName.slice(0, separator) : undefined;
}
