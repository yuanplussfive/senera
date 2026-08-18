import fs from "node:fs";
import path from "node:path";

const DesktopInstallationSelectionVersion = 2 as const;
const LegacyDesktopInstallationSelectionVersion = 1 as const;
const DesktopInstallationSelectionFileName = "installation.json";

export interface DesktopInstallationSelection {
  readonly version: typeof DesktopInstallationSelectionVersion;
  readonly workspaceRoot: string;
}

export function resolveDesktopInstallationSelectionPath(userDataRoot: string): string {
  return path.join(path.resolve(userDataRoot), DesktopInstallationSelectionFileName);
}

export function isCurrentDesktopInstallationSelection(filePath: string): boolean {
  try {
    const source = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<DesktopInstallationSelection> & {
      version?: number;
    };
    return (
      source.version === DesktopInstallationSelectionVersion &&
      typeof source.workspaceRoot === "string" &&
      source.workspaceRoot.trim().length > 0
    );
  } catch {
    return false;
  }
}

export function readDesktopInstallationSelection(filePath: string): DesktopInstallationSelection | undefined {
  try {
    const source = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<DesktopInstallationSelection> & {
      version?: number;
    };
    if (
      source.version !== DesktopInstallationSelectionVersion &&
      source.version !== LegacyDesktopInstallationSelectionVersion
    ) {
      return undefined;
    }
    if (typeof source.workspaceRoot !== "string") return undefined;
    const workspaceRoot = source.workspaceRoot.trim();
    return workspaceRoot
      ? { version: DesktopInstallationSelectionVersion, workspaceRoot: path.resolve(workspaceRoot) }
      : undefined;
  } catch {
    return undefined;
  }
}

export function writeDesktopInstallationSelection(filePath: string, selection: { workspaceRoot: string }): void {
  const absolutePath = path.resolve(filePath);
  const temporaryPath = `${absolutePath}.${process.pid}.tmp`;
  const normalized: DesktopInstallationSelection = {
    version: DesktopInstallationSelectionVersion,
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
