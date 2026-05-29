import path from "node:path";

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

export function toRuntimeModulePath(filePath: string): string {
  const absolute = path.resolve(filePath);

  if (absolute.includes(`${path.sep}Dist${path.sep}`)) {
    return absolute;
  }

  const relative = path.relative(process.cwd(), absolute);
  return path.resolve(process.cwd(), "Dist", relative).replace(/\.ts$/i, ".js");
}
