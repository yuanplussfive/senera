import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolveArtifactsConfig } from "../AgentDefaults.js";
import { assertInsideRoot } from "../Artifacts/AgentArtifactLocator.js";
import { createSeneraOutputSpool, type SeneraOutputSpool } from "../Execution/SeneraOutputSpool.js";
import type { AgentSystemConfig } from "../Types/AgentConfigTypes.js";

export interface AgentToolOutputSpoolMetadata {
  readonly sessionId?: string;
  readonly requestId?: string;
  readonly toolCallId?: string;
}

export type AgentToolOutputSpoolFactory = (
  config: AgentSystemConfig,
  workspaceRoot: string,
  metadata: AgentToolOutputSpoolMetadata,
) => Promise<SeneraOutputSpool>;

export const createAgentToolOutputSpool: AgentToolOutputSpoolFactory = async (config, workspaceRoot, metadata) => {
  const artifacts = resolveArtifactsConfig(config);
  const spoolRoot = assertInsideRoot(
    workspaceRoot,
    path.resolve(workspaceRoot, artifacts.RootDir, ".spool"),
    `artifact spool 根目录超出工作区：${artifacts.RootDir}`,
  );
  return createSeneraOutputSpool(spoolRoot, randomUUID(), {
    maxBytes: artifacts.OutputCaptureMaxBytes,
    metadata,
  });
};
