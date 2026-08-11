import { startSeneraServer } from "./ServerRuntime.js";
import { startSeneraSandboxWorkerProcess } from "./SandboxWorkerProcess.js";
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
  const sandbox = await startSeneraSandboxWorkerProcess({
    workspaceRoot,
    configPath,
    entrypoint: "Apps/SandboxWorker.ts",
    nodeArguments: ["--import", "tsx"],
    resourcesPath: workspaceRoot,
  });
  const handle = await startSeneraServer({
    configPath,
    sandboxRuntimeAvailability: sandbox.availability,
    dockerEngineWorker: sandbox.client,
  });
  installAgentProcessShutdownGuard({
    logger: processLogger,
    stop: () => Promise.all([handle.stop(), sandbox.close()]),
  });
}

await main();
