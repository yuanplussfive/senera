import { startSeneraServer } from "./ServerRuntime.js";
import { resolveAgentSandboxDevelopmentBundleRoot } from "../Source/AgentSystem/Sandbox/AgentSandboxBundlePaths.js";
import { startSeneraGvisorWorkerProcess } from "./GvisorWorkerProcess.js";
import { ensureSeneraDevelopmentConfig } from "./RuntimeConfigBootstrap.js";
import { AgentLogger } from "../Source/AgentSystem/Diagnostics/AgentLogger.js";
import {
  installAgentProcessFailureGuard,
  installAgentProcessShutdownGuard,
} from "../Source/AgentSystem/Diagnostics/AgentProcessGuard.js";

const processLogger = new AgentLogger();
installAgentProcessFailureGuard({ logger: processLogger });

async function main(): Promise<void> {
  const workspaceRoot = process.cwd();
  const configPath = ensureSeneraDevelopmentConfig(workspaceRoot);
  const worker = await startSeneraGvisorWorkerProcess({
    workspaceRoot,
    configPath,
    entrypoint: "Apps/GvisorWorker.ts",
    nodeArguments: ["--import", "tsx"],
    resourcesPath: workspaceRoot,
  });
  const handle = await startSeneraServer({
    configPath,
    sandboxBundleRoot: resolveAgentSandboxDevelopmentBundleRoot(workspaceRoot),
    sandboxProvider: worker?.provider,
    dockerEngineWorker: worker?.client,
  });
  installAgentProcessShutdownGuard({
    logger: processLogger,
    stop: () => Promise.all([handle.stop(), worker?.close()]),
  });
}

await main();
