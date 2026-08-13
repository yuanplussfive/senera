import fs from "node:fs";
import path from "node:path";

const DesktopInstallationSelectionVersion = 1 as const;
const DesktopInstallationSelectionFileName = "installation.json";

export interface DesktopInstallationSelection {
  readonly version: typeof DesktopInstallationSelectionVersion;
  readonly dataRoot: string;
  readonly workspaceRoot: string;
}

export function resolveDesktopInstallationSelectionPath(userDataRoot: string): string {
  return path.join(path.resolve(userDataRoot), DesktopInstallationSelectionFileName);
}

export function readDesktopInstallationSelection(filePath: string): DesktopInstallationSelection | undefined {
  try {
    const source = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<DesktopInstallationSelection>;
    if (
      source.version !== DesktopInstallationSelectionVersion ||
      typeof source.dataRoot !== "string" ||
      typeof source.workspaceRoot !== "string"
    ) {
      return undefined;
    }
    const dataRoot = source.dataRoot.trim();
    const workspaceRoot = source.workspaceRoot.trim();
    return dataRoot && workspaceRoot
      ? {
          version: DesktopInstallationSelectionVersion,
          dataRoot: path.resolve(dataRoot),
          workspaceRoot: path.resolve(workspaceRoot),
        }
      : undefined;
  } catch {
    return undefined;
  }
}

export function writeDesktopInstallationSelection(
  filePath: string,
  selection: Omit<DesktopInstallationSelection, "version">,
): void {
  const absolutePath = path.resolve(filePath);
  const temporaryPath = `${absolutePath}.${process.pid}.tmp`;
  const normalized: DesktopInstallationSelection = {
    version: DesktopInstallationSelectionVersion,
    dataRoot: path.resolve(selection.dataRoot),
    workspaceRoot: path.resolve(selection.workspaceRoot),
  };
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  try {
    fs.renameSync(temporaryPath, absolutePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

export function isDesktopDataDirectory(value: string): boolean {
  try {
    return fs.statSync(path.resolve(value)).isDirectory();
  } catch {
    return false;
  }
}
