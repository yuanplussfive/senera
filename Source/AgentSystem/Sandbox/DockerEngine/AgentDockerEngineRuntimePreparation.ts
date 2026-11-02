import type { SeneraSandboxWorkerClient } from "../../Execution/SeneraSandboxWorkerTypes.js";
import type { ResolvedAgentSandboxRuntimeConfig } from "../../Types/AgentConfigTypes.js";
import { resolveAgentSandboxRuntimePaths } from "../AgentSandboxRuntimePreparation.js";
import { AgentSandboxPreparationStages, type AgentSandboxPreparationProgress } from "../AgentSandboxRuntimeTypes.js";
import type { AgentSandboxRuntimeProvider } from "../AgentSandboxRuntimeTypes.js";

export { resolveAgentSandboxWorkerEndpoint } from "./AgentDockerEngineEndpoint.js";

export interface AgentDockerEngineRuntimePreparationOptions {
  workspaceRoot: string;
  config: ResolvedAgentSandboxRuntimeConfig;
  worker: SeneraSandboxWorkerClient;
  expectedProvider?: Extract<AgentSandboxRuntimeProvider, "gvisor" | "docker-engine">;
  onProgress?: (progress: AgentSandboxPreparationProgress) => void;
}

export async function prepareAgentDockerEngineRuntime(options: AgentDockerEngineRuntimePreparationOptions): Promise<{
  paths: ReturnType<typeof resolveAgentSandboxRuntimePaths>;
  preparedImages: string[];
}> {
  const report = options.onProgress ?? (() => undefined);
  report({ stage: AgentSandboxPreparationStages.ConnectingWorker });
  await options.worker.prepare({
    timeoutMs: options.config.Docker.PreparationTimeoutSeconds * 1000,
    onProgress: report,
  });
  const probe = await options.worker.probe({
    timeoutMs: options.config.Docker.PreparationTimeoutSeconds * 1000,
  });
  if (!probe.imageReady || (options.expectedProvider && probe.isolation !== options.expectedProvider)) {
    throw new Error(
      `Docker Engine sandbox worker completed preparation without the selected ready runtime image${
        options.expectedProvider ? ` (${options.expectedProvider})` : ""
      }.`,
    );
  }
  return {
    paths: resolveAgentSandboxRuntimePaths(options.workspaceRoot, options.config),
    preparedImages: [probe.image],
  };
}
