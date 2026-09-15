import path from "node:path";
import { fileURLToPath } from "node:url";

export function resolveFrom(basePath: string, targetPath: string): string {
  if (path.isAbsolute(targetPath)) {
    return path.normalize(targetPath);
  }

  return path.resolve(basePath, targetPath);
}

/** Returns the platform-relative path when target is inside root, including root itself. */
export function relativePathWithin(root: string, target: string): string | undefined {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`) ? undefined : relative;
}

export function isPathWithin(root: string, target: string): boolean {
  return relativePathWithin(root, target) !== undefined;
}

export function isSamePath(left: string, right: string): boolean {
  return path.relative(path.resolve(left), path.resolve(right)) === "";
}

export function fileSystemPathIdentity(value: string, platform: NodeJS.Platform = process.platform): string {
  const normalized = path.resolve(value);
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

export function toFileUrl(filePath: string): string {
  const normalized = path.resolve(filePath).replace(/\\/g, "/");
  return `file:///${normalized.replace(/^\/+/, "")}`;
}

export function moduleFilePath(importMetaUrl: string): string {
  return fileURLToPath(importMetaUrl);
}

export function moduleDirPath(importMetaUrl: string): string {
  return path.dirname(moduleFilePath(importMetaUrl));
}

export function isMainModule(importMetaUrl: string, argv: readonly string[] = process.argv): boolean {
  const entryPath = argv[1];
  return Boolean(entryPath) && path.resolve(entryPath) === moduleFilePath(importMetaUrl);
}

export function toRuntimeModulePath(filePath: string): string {
  const absolute = path.resolve(filePath);

  if (absolute.includes(`${path.sep}Dist${path.sep}`)) {
    return absolute;
  }

  const relative = path.relative(runtimeAppRoot(), absolute);
  return path.resolve(runtimeAppRoot(), "Dist", relative).replace(/\.ts$/i, ".js");
}

function runtimeAppRoot(): string {
  const currentDir = moduleDirPath(import.meta.url);
  const distSegment = `${path.sep}Dist${path.sep}`;
  const distIndex = currentDir.lastIndexOf(distSegment);
  if (distIndex >= 0) {
    return currentDir.slice(0, distIndex);
  }

  return process.cwd();
}
