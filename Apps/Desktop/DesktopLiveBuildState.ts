import fs from "node:fs";
import path from "node:path";

const DesktopLiveSourceRoots = ["Apps", "Build", "Plugins", "Source", "Scripts", "System"] as const;
const DesktopLiveConfigFiles = ["tsconfig.json", "package.json"] as const;

/**
 * TypeScript still rebuilds the whole program and spends tens of seconds when
 * nothing changed, so the live launcher compares source timestamps against the
 * build info written by the last successful emit instead of asking tsc.
 */
export function isDesktopLiveBuildCurrent(
  workspaceRoot: string,
  buildInfoPath: string,
  mainOutputPath: string,
): boolean {
  const buildState = fs.statSync(buildInfoPath, { throwIfNoEntry: false });
  if (!buildState || !fs.existsSync(mainOutputPath)) return false;

  const newestSourceChange = newestDesktopLiveSourceChangeMs(workspaceRoot);
  return newestSourceChange !== undefined && newestSourceChange <= buildState.mtimeMs;
}

export function newestDesktopLiveSourceChangeMs(workspaceRoot: string): number | undefined {
  let newest: number | undefined;
  const record = (filePath: string): void => {
    const stat = fs.statSync(filePath, { throwIfNoEntry: false });
    if (stat && (newest === undefined || stat.mtimeMs > newest)) newest = stat.mtimeMs;
  };

  for (const file of DesktopLiveConfigFiles) record(path.join(workspaceRoot, file));
  for (const rootName of DesktopLiveSourceRoots) {
    const root = path.join(workspaceRoot, rootName);
    if (!fs.existsSync(root)) continue;
    // The root itself matters: deleting a file directly inside it updates this
    // directory, and recursive readdir never reports the directory it walked.
    record(root);
    for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
      const entryPath = path.join(entry.parentPath, entry.name);
      // Directories are recorded too: deleting a source updates its parent, not the
      // remaining files, and a skipped emit would leave the old module behind.
      if (entry.isDirectory() || entry.name.endsWith(".ts")) record(entryPath);
    }
  }
  return newest;
}
