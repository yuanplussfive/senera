import fs from "node:fs";
import path from "node:path";
import { isFileExistsError } from "./AgentFs.js";
import { listAgentWorkspaceShareableStateDirectories, resolveAgentWorkspaceLayout } from "./AgentWorkspaceLayout.js";

const StateIgnoreFileName = ".gitignore";

/**
 * Deny by default, then re-open only what a project shares on purpose. Git will not look inside an
 * ignored directory at all, so each shared name is re-included twice: once for the directory, once for
 * its contents.
 */
function renderStateIgnoreContents(): string {
  const shared = listAgentWorkspaceShareableStateDirectories().flatMap((name) => [`!/${name}/`, `!/${name}/**`]);
  return [
    "# Written by Senera the first time it opened this workspace, and never rewritten.",
    "# Senera keeps its runtime state here: databases, logs, caches and exports. Edit or delete these",
    "# lines to decide what your own repository tracks.",
    "*",
    `!/${StateIgnoreFileName}`,
    ...shared,
    "",
  ].join("\n");
}

/**
 * A workspace directory is a user's project folder, and `git add .` there used to stage runtime state
 * along with it. Senera writes the state directory's own ignore file on every open, and leaves any file
 * the user already placed there untouched, so a project that manages its own rules keeps managing them.
 */
export function ensureAgentWorkspaceStateDirectoryIgnored(workspaceRoot: string): void {
  const layout = resolveAgentWorkspaceLayout(workspaceRoot);
  const ignorePath = path.join(layout.projectStateRoot, StateIgnoreFileName);
  try {
    fs.mkdirSync(layout.projectStateRoot, { recursive: true });
    fs.writeFileSync(ignorePath, renderStateIgnoreContents(), { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (isFileExistsError(error)) return;
    // A volume that refuses the write cannot be fixed from here, and a missing ignore file must not
    // stop the workspace from opening. The next open tries again, and the file's absence is visible.
  }
}
