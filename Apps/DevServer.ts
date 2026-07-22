import { startSeneraServer } from "./ServerRuntime.js";
import { createSourceAgentMcpRuntimeModuleResolver } from "../Source/AgentSystem/Mcp/AgentMcpRuntimeModuleResolver.js";

function main(): void {
  const handle = startSeneraServer({
    runtimeModuleResolver: createSourceAgentMcpRuntimeModuleResolver(process.cwd()),
  });
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (): void => {
    shutdownPromise ??= handle.stop().finally(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
