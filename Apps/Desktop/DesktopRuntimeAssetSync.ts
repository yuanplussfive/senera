import fs from "node:fs";
import path from "node:path";

export interface DesktopRuntimeDirectorySyncOptions {
  preserveFileNames?: readonly string[];
  pruneExtraneous?: boolean;
}

export function syncDesktopRuntimeDirectory(
  sourceRoot: string,
  targetRoot: string,
  options: DesktopRuntimeDirectorySyncOptions = {},
): void {
  if (!fs.existsSync(sourceRoot)) {
    return;
  }

  const preserveFileNames = new Set(options.preserveFileNames ?? []);
  fs.mkdirSync(targetRoot, { recursive: true });

  const sourceEntries = fs.readdirSync(sourceRoot, { withFileTypes: true });
  const sourceNames = new Set(sourceEntries.map((entry) => entry.name));
  if (options.pruneExtraneous) {
    pruneExtraneousEntries(targetRoot, sourceNames, preserveFileNames);
  }

  for (const entry of sourceEntries) {
    const sourcePath = path.join(sourceRoot, entry.name);
    const targetPath = path.join(targetRoot, entry.name);

    if (entry.isDirectory()) {
      ensureTargetDirectory(targetPath);
      syncDesktopRuntimeDirectory(sourcePath, targetPath, options);
      continue;
    }

    if (entry.isFile()) {
      ensureTargetFilePath(targetPath);
      copyFileIfChanged(sourcePath, targetPath, {
        preserveExisting: preserveFileNames.has(entry.name),
      });
    }
  }
}

function pruneExtraneousEntries(
  targetRoot: string,
  sourceNames: ReadonlySet<string>,
  preserveFileNames: ReadonlySet<string>,
): void {
  for (const entry of fs.readdirSync(targetRoot, { withFileTypes: true })) {
    if (sourceNames.has(entry.name)) {
      continue;
    }

    if (entry.isFile() && preserveFileNames.has(entry.name)) {
      continue;
    }

    fs.rmSync(path.join(targetRoot, entry.name), {
      recursive: entry.isDirectory(),
      force: true,
    });
  }
}

function ensureTargetDirectory(targetPath: string): void {
  if (fs.existsSync(targetPath) && !fs.statSync(targetPath).isDirectory()) {
    fs.rmSync(targetPath, { force: true });
  }
  fs.mkdirSync(targetPath, { recursive: true });
}

function ensureTargetFilePath(targetPath: string): void {
  if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

function copyFileIfChanged(
  sourcePath: string,
  targetPath: string,
  options: { preserveExisting?: boolean } = {},
): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (options.preserveExisting && fs.existsSync(targetPath)) {
    return;
  }

  if (fs.existsSync(targetPath)) {
    const source = fs.statSync(sourcePath);
    const target = fs.statSync(targetPath);
    if (source.size === target.size && source.mtimeMs <= target.mtimeMs) {
      return;
    }
  }

  fs.copyFileSync(sourcePath, targetPath);
}
