import fs from "node:fs";
import path from "node:path";

export interface WalkFilesOptions {
  extensions?: readonly string[];
  excludeDirectoryNames?: ReadonlySet<string>;
  filter?: (relativePath: string) => boolean;
}

export function walkFiles(rootDir: string, options: WalkFilesOptions = {}): string[] {
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    return [];
  }
  const files: string[] = [];
  collectFiles(rootDir, rootDir, options, files);
  return files.sort(compareLexicographically);
}

export function toPosixRelative(rootDir: string, filePath: string): string {
  return toPosixPath(path.relative(rootDir, filePath));
}

export function toPosixPath(value: string): string {
  return value.replaceAll("\\", "/");
}

function collectFiles(rootDir: string, directory: string, options: WalkFilesOptions, files: string[]): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (options.excludeDirectoryNames?.has(entry.name)) {
        continue;
      }
      collectFiles(rootDir, entryPath, options, files);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (options.extensions && !options.extensions.some((extension) => entry.name.endsWith(extension))) {
      continue;
    }
    if (options.filter && !options.filter(toPosixRelative(rootDir, entryPath))) {
      continue;
    }
    files.push(entryPath);
  }
}

function compareLexicographically(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
