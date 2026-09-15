import crypto from "node:crypto";
import path from "node:path";
import { assertInsideRoot } from "../Artifacts/AgentArtifactLocator.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";

export const DefaultAgentUploadRootDir = ".senera/uploads";

export const AgentUploadFileNames = {
  Original: "original",
  Manifest: "manifest.json",
} as const;

export function createAgentUploadId(): string {
  return `upl_${crypto.randomBytes(16).toString("hex")}`;
}

export function resolveAgentUploadRoot(workspaceRoot: string, rootDir: string): string {
  return assertInsideRoot(
    workspaceRoot,
    path.resolve(workspaceRoot, rootDir),
    agentErrorMessage("upload.rootOutsideWorkspace", { rootDir }),
  );
}

export function resolveAgentUploadDir(uploadRoot: string, resourceId: string): string {
  return assertInsideRoot(
    uploadRoot,
    path.resolve(uploadRoot, resourceId),
    agentErrorMessage("upload.directoryOutsideRoot", { resourceId }),
  );
}

export function resolveAgentUploadFile(uploadRoot: string, resourceId: string, fileName: string): string {
  const uploadDir = resolveAgentUploadDir(uploadRoot, resourceId);
  return assertInsideRoot(
    uploadDir,
    path.resolve(uploadDir, fileName),
    agentErrorMessage("upload.fileOutsideDirectory", { resourceId, fileName }),
  );
}
