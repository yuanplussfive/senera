import { SeneraServerDeployments, startSeneraServer } from "./ServerRuntime.js";
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
  const handle = await startSeneraServer({
    configPath,
    deployment: SeneraServerDeployments.Local,
  });
  installAgentProcessShutdownGuard({
    logger: processLogger,
    stop: () => handle.stop(),
  });
}

await main();
