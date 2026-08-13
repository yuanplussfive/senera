import fs from "node:fs";
import path from "node:path";

const DesktopWorkspaceSelectionVersion = 1 as const;

export interface DesktopWorkspaceSelection {
  readonly version: typeof DesktopWorkspaceSelectionVersion;
  readonly workspaceRoot: string;
}

export function resolveDesktopWorkspaceSelectionPath(userDataRoot: string): string {
  return path.join(path.resolve(userDataRoot), "workspace.json");
}

export function readDesktopWorkspaceSelection(filePath: string): string | undefined {
  try {
    const source = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<DesktopWorkspaceSelection>;
    if (source.version !== DesktopWorkspaceSelectionVersion || typeof source.workspaceRoot !== "string")
      return undefined;
    const workspaceRoot = source.workspaceRoot.trim();
    return workspaceRoot ? path.resolve(workspaceRoot) : undefined;
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    return undefined;
  }
}

/**
 * Reads the pre-installation-selection workspace marker without accepting the
 * old bug where the Electron userData directory was recorded as the project.
 */
export function readLegacyDesktopWorkspaceSelection(filePath: string, dataRoot: string): string | undefined {
  const workspaceRoot = readDesktopWorkspaceSelection(filePath);
  if (!workspaceRoot) return undefined;
  const normalizedWorkspaceRoot = path.resolve(workspaceRoot);
  const normalizedDataRoot = path.resolve(dataRoot);
  return process.platform === "win32"
    ? normalizedWorkspaceRoot.toLocaleLowerCase() === normalizedDataRoot.toLocaleLowerCase()
      ? undefined
      : normalizedWorkspaceRoot
    : normalizedWorkspaceRoot === normalizedDataRoot
      ? undefined
      : normalizedWorkspaceRoot;
}

export function writeDesktopWorkspaceSelection(filePath: string, workspaceRoot: string): void {
  const selection: DesktopWorkspaceSelection = {
    version: DesktopWorkspaceSelectionVersion,
    workspaceRoot: path.resolve(workspaceRoot),
  };
  const absolutePath = path.resolve(filePath);
  const temporaryPath = `${absolutePath}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(temporaryPath, `${JSON.stringify(selection, null, 2)}\n`, "utf8");
  try {
    fs.renameSync(temporaryPath, absolutePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

export function isDesktopWorkspaceDirectory(value: string): boolean {
  try {
    return fs.statSync(path.resolve(value)).isDirectory();
  } catch {
    return false;
  }
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
