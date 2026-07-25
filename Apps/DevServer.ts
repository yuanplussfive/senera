import { startSeneraServer } from "./ServerRuntime.js";
import { createSourceAgentMcpRuntimeModuleResolver } from "../Source/AgentSystem/Mcp/AgentMcpRuntimeModuleResolver.js";
import { resolveAgentSandboxDevelopmentBundleRoot } from "../Source/AgentSystem/Sandbox/AgentSandboxBundlePaths.js";
import { resolveSeneraServerConfigPath, startSeneraGvisorWorkerProcess } from "./GvisorWorkerProcess.js";

async function main(): Promise<void> {
  const workspaceRoot = process.cwd();
  const worker = await startSeneraGvisorWorkerProcess({
    workspaceRoot,
    configPath: resolveSeneraServerConfigPath(workspaceRoot),
    entrypoint: "Apps/GvisorWorker.ts",
    nodeArguments: ["--import", "tsx"],
    resourcesPath: workspaceRoot,
  });
  const handle = startSeneraServer({
    runtimeModuleResolver: createSourceAgentMcpRuntimeModuleResolver(workspaceRoot),
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
