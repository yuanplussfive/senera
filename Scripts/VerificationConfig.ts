import path from "node:path";
import { AgentConfigLoader } from "../Source/AgentSystem/Config/AgentConfigLoader.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";

export const VerificationConfigFileName = "senera.config.example.json";

export function verificationConfigPath(workspaceRoot: string = process.cwd()): string {
  return path.join(workspaceRoot, VerificationConfigFileName);
}

export function loadVerificationConfig(workspaceRoot: string = process.cwd()): AgentSystemConfig {
  return AgentConfigLoader.load(verificationConfigPath(workspaceRoot));
}
