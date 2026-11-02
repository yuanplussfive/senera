import { SeneraServerDeployments, startSeneraServer } from "./ServerRuntime.js";
import { ensureSeneraDevelopmentConfig } from "./RuntimeConfigBootstrap.js";
import { AgentLogger } from "../Source/AgentSystem/Diagnostics/AgentLogger.js";
import { AgentServerAccessProfiles } from "../Source/AgentSystem/Auth/AgentServerAccessPolicy.js";
import fs from "node:fs";
import { resolveFrontendConfig } from "../Source/AgentSystem/AgentDefaults.js";
import {
  installAgentProcessFailureGuard,
  installAgentProcessShutdownGuard,
} from "../Source/AgentSystem/Diagnostics/AgentProcessGuard.js";

const processLogger = new AgentLogger();
installAgentProcessFailureGuard({ logger: processLogger });

async function main(): Promise<void> {
  const workspaceRoot = process.cwd();
  const configPath = ensureSeneraDevelopmentConfig(workspaceRoot);
  const frontend = resolveFrontendConfig(JSON.parse(fs.readFileSync(configPath, "utf8"))).DevServer;
  const frontendHost = frontend.Host === "0.0.0.0" || frontend.Host === "::" ? "localhost" : frontend.Host;
  const developmentFrontendUrl = new URL(`http://${frontendHost.includes(":") ? `[${frontendHost}]` : frontendHost}`);
  developmentFrontendUrl.port = String(frontend.Port);
  const handle = await startSeneraServer({
    configPath,
    deployment: SeneraServerDeployments.Local,
    // Vite serves the development UI from a separate loopback port.
    accessProfile: AgentServerAccessProfiles.Development,
    developmentFrontendUrl: developmentFrontendUrl.href,
  });
  installAgentProcessShutdownGuard({
    logger: processLogger,
    stop: () => handle.stop(),
  });
}

await main();
