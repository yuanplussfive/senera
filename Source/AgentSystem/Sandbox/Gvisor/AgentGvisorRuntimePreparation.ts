import path from "node:path";
import type { SeneraGvisorWorkerClient } from "../../Execution/SeneraGvisorTypes.js";
import type { ResolvedAgentSandboxRuntimeConfig } from "../../Types/AgentConfigTypes.js";
import { resolveAgentSandboxRuntimePaths } from "../AgentSandboxRuntimePreparation.js";
import { AgentSandboxPreparationStages, type AgentSandboxPreparationProgress } from "../AgentSandboxRuntimeTypes.js";
import type { AgentSandboxRuntimeProvider } from "../AgentSandboxRuntimeTypes.js";

export interface AgentGvisorRuntimePreparationOptions {
  workspaceRoot: string;
  config: ResolvedAgentSandboxRuntimeConfig;
  worker: SeneraGvisorWorkerClient;
  expectedProvider?: Extract<AgentSandboxRuntimeProvider, "gvisor" | "docker-engine">;
  onProgress?: (progress: AgentSandboxPreparationProgress) => void;
}

export async function prepareAgentGvisorRuntime(options: AgentGvisorRuntimePreparationOptions): Promise<{
  paths: ReturnType<typeof resolveAgentSandboxRuntimePaths>;
  preparedImages: string[];
}> {
  const report = options.onProgress ?? (() => undefined);
  report({ stage: AgentSandboxPreparationStages.ConnectingWorker });
  await options.worker.prepare({
    timeoutMs: options.config.Gvisor.PreparationTimeoutSeconds * 1000,
    onProgress: report,
  });
  const probe = await options.worker.probe({
    timeoutMs: options.config.Gvisor.PreparationTimeoutSeconds * 1000,
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

export function resolveAgentGvisorWorkerSocketPath(
  workspaceRoot: string,
  config: Pick<ResolvedAgentSandboxRuntimeConfig, "BaseDir" | "Gvisor">,
): string {
  const configured = config.Gvisor.WorkerSocketPath;
  if (path.isAbsolute(configured)) return path.normalize(configured);
  const runtimePaths = resolveAgentSandboxRuntimePaths(workspaceRoot, config);
  return path.resolve(runtimePaths.baseDir, configured);
}
