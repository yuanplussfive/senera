import fs from "node:fs/promises";
import path from "node:path";
import { isMissingFileError } from "../Core/AgentFs.js";
import type { resolveAgentApplicationPaths } from "../Core/AgentApplicationPaths.js";
import type { AgentWorkspaceCatalog } from "./AgentWorkspaceCatalog.js";
import type { AgentApplicationStorageSnapshot } from "./AgentApplicationStorageContract.js";

export async function readAgentApplicationStorage(
  paths: ReturnType<typeof resolveAgentApplicationPaths>,
  catalog?: AgentWorkspaceCatalog,
): Promise<AgentApplicationStorageSnapshot> {
  const workspaces = await Promise.all(
    (catalog?.list() ?? []).map(async (workspace) => ({
      ...workspace,
      bytes: await directoryBytes(paths.workspaceLayout(workspace.root, workspace.id).stateRoot),
    })),
  );
  return { root: paths.root, bytes: await directoryBytes(paths.root), workspaces };
}

/** Counts owned regular files without traversing links to project or external directories. */
async function directoryBytes(root: string): Promise<number> {
  let directory;
  try {
    directory = await fs.opendir(root);
  } catch (error) {
    if (isMissingFileError(error)) return 0;
    throw error;
  }
  let bytes = 0;
  for await (const entry of directory) {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) bytes += await directoryBytes(filePath);
    else if (entry.isFile()) {
      try {
        bytes += (await fs.lstat(filePath)).size;
      } catch (error) {
        if (!isMissingFileError(error)) throw error;
      }
    }
  }
  return bytes;
}
