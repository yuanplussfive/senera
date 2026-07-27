import fs from "node:fs";
import { isMissingFileError, writeFileAtomicSync } from "../Source/AgentSystem/Core/AgentFs.js";
import { toPosixRelative } from "../Scripts/Support/FileWalk.js";

export function readOptionalUtf8(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
}

export function synchronizeGeneratedFile(options: {
  filePath: string;
  content: string;
  check: boolean;
  regenerateCommand: string;
}): void {
  if (readOptionalUtf8(options.filePath) === options.content) return;
  if (options.check) {
    throw new Error(`${workspaceRelativePath(options.filePath)} is stale. Run ${options.regenerateCommand}.`);
  }
  writeUtf8Atomically(options.filePath, options.content);
}

export function writeUtf8Atomically(filePath: string, content: string): void {
  writeFileAtomicSync(filePath, content);
}

function workspaceRelativePath(filePath: string): string {
  return toPosixRelative(process.cwd(), filePath);
}
