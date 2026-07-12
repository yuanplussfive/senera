import path from "node:path";
import { fileURLToPath } from "node:url";

export function resolveFrom(basePath: string, targetPath: string): string {
  if (path.isAbsolute(targetPath)) {
    return path.normalize(targetPath);
  }

  return path.resolve(basePath, targetPath);
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

  const pluginRelativePath = runtimePluginRelativePath(absolute);
  if (pluginRelativePath) {
    return path.resolve(runtimeAppRoot(), "Dist", pluginRelativePath).replace(/\.ts$/i, ".js");
  }

  const relative = path.relative(runtimeAppRoot(), absolute);
  return path.resolve(runtimeAppRoot(), "Dist", relative).replace(/\.ts$/i, ".js");
}

function runtimePluginRelativePath(filePath: string): string | undefined {
  const normalized = path.normalize(filePath);
  for (const marker of [`${path.sep}System${path.sep}Plugins${path.sep}`, `${path.sep}Plugins${path.sep}`]) {
    const index = normalized.lastIndexOf(marker);
    if (index >= 0) {
      return normalized.slice(index + path.sep.length);
    }
  }

  return undefined;
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
