import { startSeneraServer } from "./ServerRuntime.js";
import { createCompiledAgentMcpRuntimeModuleResolver } from "../Source/AgentSystem/Mcp/AgentMcpRuntimeModuleResolver.js";
import { resolveAgentSandboxDevelopmentBundleRoot } from "../Source/AgentSystem/Sandbox/AgentSandboxBundlePaths.js";
import { startSeneraGvisorWorkerProcess } from "./GvisorWorkerProcess.js";
import { ensureSeneraDevelopmentConfig } from "./RuntimeConfigBootstrap.js";

async function main(): Promise<void> {
  const workspaceRoot = process.cwd();
  const configPath = ensureSeneraDevelopmentConfig(workspaceRoot);
  const worker = await startSeneraGvisorWorkerProcess({
    workspaceRoot,
    configPath,
    entrypoint: "Dist/Apps/GvisorWorker.js",
    resourcesPath: workspaceRoot,
  });
  const handle = startSeneraServer({
    configPath,
    runtimeModuleResolver: createCompiledAgentMcpRuntimeModuleResolver(workspaceRoot),
    sandboxBundleRoot: resolveAgentSandboxDevelopmentBundleRoot(workspaceRoot),
    sandboxProvider: worker?.provider,
    dockerEngineWorker: worker?.client,
  });
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (): void => {
    shutdownPromise ??= Promise.all([handle.stop(), worker?.close()])
      .then(() => undefined)
      .finally(() => {
        process.exit(0);
      });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

await main();
