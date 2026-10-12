import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { writeFileAtomicSync } from "../../Source/AgentSystem/Core/AgentFs.js";

const DesktopWorkspaceSelectionVersion = 1 as const;
const DesktopWorkspaceSelectionSchema = z
  .object({
    version: z.literal(DesktopWorkspaceSelectionVersion),
    workspaceRoot: z
      .string()
      .trim()
      .min(1)
      .refine(path.isAbsolute, "Workspace selection must be an absolute directory path."),
  })
  .strict();

export interface DesktopWorkspaceSelection {
  readonly version: typeof DesktopWorkspaceSelectionVersion;
  readonly workspaceRoot: string;
}

export function resolveDesktopWorkspaceSelectionPath(userDataRoot: string): string {
  return path.join(path.resolve(userDataRoot), "workspace.json");
}

export function readDesktopWorkspaceSelection(filePath: string): string | undefined {
  try {
    const source = DesktopWorkspaceSelectionSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
    return path.resolve(source.workspaceRoot);
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
}

export function writeDesktopWorkspaceSelection(filePath: string, workspaceRoot: string): void {
  const selection: DesktopWorkspaceSelection = {
    version: DesktopWorkspaceSelectionVersion,
    workspaceRoot: path.resolve(workspaceRoot),
  };
  writeFileAtomicSync(filePath, `${JSON.stringify(selection, null, 2)}\n`, { fsync: true });
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
