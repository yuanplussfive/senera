import { randomUUID } from "node:crypto";
import { rename, rm } from "node:fs/promises";
import { nodeErrorCode } from "../../Source/AgentSystem/Core/AgentFs.js";

const TemporaryWorkspaceCleanupPolicy = Object.freeze({
  maxRetries: 10,
  retryDelayMs: 100,
});
const DeferredCleanupErrorCodes = new Set(["EBUSY", "EPERM"]);

export async function removeTemporaryWorkspace(targetPath: string): Promise<void> {
  try {
    await rm(targetPath, {
      recursive: true,
      force: true,
      maxRetries: TemporaryWorkspaceCleanupPolicy.maxRetries,
      retryDelay: TemporaryWorkspaceCleanupPolicy.retryDelayMs,
    });
    return;
  } catch (error) {
    if (!isDeferredCleanupError(error)) throw error;
  }

  try {
    await rename(targetPath, `${targetPath}.pending-delete-${randomUUID()}`);
  } catch (error) {
    if (!isDeferredCleanupError(error)) throw error;
  }
}

function isDeferredCleanupError(error: unknown): boolean {
  return DeferredCleanupErrorCodes.has(nodeErrorCode(error) ?? "");
}
