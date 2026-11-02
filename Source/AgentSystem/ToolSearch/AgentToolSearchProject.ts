import { sha256Hex } from "../Core/AgentHash.js";
import { fileSystemPathIdentity } from "../Core/AgentPath.js";

export function createAgentToolSearchProjectId(workspaceRoot: string): string {
  return sha256Hex(fileSystemPathIdentity(workspaceRoot));
}
